import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'source-private', 'BIOLOGY_CH01_CONTENT_MASTER.txt');
const OUT_JS = path.join(ROOT, 'assets', 'js', 'questions.js');
const VER_DIR = path.join(ROOT, 'verification');
const OUT_UNPARSED = path.join(VER_DIR, 'unparsed-records.json');
const OUT_REPORT = path.join(VER_DIR, 'generation-report.json');
const OUT_LESSON_COUNTS = path.join(VER_DIR, 'lesson-counts.json');
const METADATA_FILE = path.join(ROOT, 'metadata.json');

const SUPPORTED_TYPES = [
  'written',
  'list',
  'comparison',
  'fill',
  'mcq',
  'drawing',
  'true-false-correction',
  'fixed-underlined-true-false',
  'multi-part'
];

function parseInteger(value) {
  if (!value) return null;
  const num = parseInt(String(value).trim(), 10);
  return Number.isFinite(num) ? num : null;
}

function normalizeQuestionType(rawType, questionText) {
  const lower = String(rawType || '').trim();
  const text = String(questionText || '').trim();

  const mapping = [
    ['اختر الإجابة الصحيحة من بين الأقواس', 'mcq'],
    ['اختر الإجابة الصحيحة', 'mcq'],
    ['اختر من بين الأقواس', 'mcq'],
    ['اختر الإجابة', 'mcq'],
    ['املأ الفراغات', 'fill'],
    ['املأ', 'fill'],
    ['رسم', 'drawing'],
    ['رســم', 'drawing'],
    ['صح أم خطأ مع تصحيح', 'true-false-correction'],
    ['صح أم خطأ', 'true-false-correction'],
    ['صح او خطأ', 'true-false-correction'],
    ['قارن بين', 'comparison'],
    ['قارن', 'comparison'],
    ['قائمة', 'list'],
    ['اعدد', 'list'],
    ['عدد', 'written'],
    ['عرف', 'written'],
    ['علل', 'written'],
    ['اكتب', 'written'],
    ['ما', 'written'],
    ['لماذا', 'written'],
    ['السؤال', 'written']
  ];

  for (const [pattern, type] of mapping) {
    if (lower.includes(pattern) || text.includes(pattern)) {
      return type;
    }
  }

  if (text.includes('(') && text.includes(',')) {
    return 'mcq';
  }

  return 'written';
}

function extractExamReferences(explicitRaw, questionText, answerText) {
  const rawCandidates = [];
  const source = [explicitRaw || '', questionText || '', answerText || ''].join(' ');
  const tokenRegex = /\(([^)]+)\)/g;
  let match;
  while ((match = tokenRegex.exec(source)) !== null) {
    const value = match[1].trim();
    if (!value) continue;
    rawCandidates.push(value);
  }

  const filtered = rawCandidates.filter(value => {
    return /\d{4}|أسئلة الفصل|أسئلة التلفزيون التربوي|خارج القطر|تمهيدي|تكميلي|المتميزين|النازحين|سؤال وزاري|تعليل وزاري|رسم وزاري|تحليلي/i.test(value);
  });

  const result = filtered.length ? filtered : rawCandidates;
  if (result.length) {
    return [{ raw: result.join(' | ') }];
  }

  if (String(explicitRaw || '').trim()) {
    return [{ raw: String(explicitRaw).trim() }];
  }

  return [{ raw: 'بدون مراجع' }];
}

function replaceFillPlaceholders(questionText, modelAnswer) {
  const fillGroups = [];
  const pattern = /\(([^)]+)\)/g;
  let match;
  let found = false;
  let workingQuestion = questionText;
  const allGroups = [];
  while ((match = pattern.exec(questionText)) !== null) {
    allGroups.push(match[1].trim());
  }

  for (const group of allGroups) {
    if (/\d{4}|أسئلة الفصل|أسئلة التلفزيون التربوي|خارج القطر|تمهيدي|تكميلي|المتميزين|النازحين|سؤال وزاري|تعليل وزاري|رسم وزاري|تحليلي/i.test(group)) {
      continue;
    }
    if (group.length === 0) continue;
    fillGroups.push(group);
  }

  if (fillGroups.length === 0 && modelAnswer) {
    fillGroups.push(modelAnswer.split(/\n/).map(line => line.trim()).filter(Boolean).join(' '));
  }

  if (fillGroups.length === 0) {
    return { question: questionText, blanks: [] };
  }

  const placeholderQuestion = questionText.replace(/\(([^)]+)\)/, '____');
  return { question: placeholderQuestion, blanks: fillGroups.map(value => value.trim()).filter(Boolean) };
}

function parseMcq(questionText, modelAnswer) {
  const result = { options: [], correctAnswerIndex: null };
  const questionOnly = questionText.replace(/\(([^)]+)\)\s*$/, '').trim();
  const groups = [];
  const pattern = /\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(questionText)) !== null) {
    const content = match[1].trim();
    if (/\d{4}|أسئلة الفصل|أسئلة التلفزيون التربوي|خارج القطر|تمهيدي|تكميلي|المتميزين|النازحين|سؤال وزاري|تعليل وزاري|رسم وزاري/i.test(content)) {
      continue;
    }
    if (content.includes(',') || content.includes('،')) {
      groups.push(content);
    }
  }

  if (groups.length) {
    const rawOptions = groups[0].split(/[,،]/).map(item => item.trim()).filter(Boolean);
    result.options = rawOptions;
    const normalizedAnswer = String(modelAnswer || '').trim().replace(/[.。]$/, '');
    result.correctAnswerIndex = rawOptions.findIndex(opt => opt.replace(/[.。]$/, '').trim() === normalizedAnswer);
    if (result.correctAnswerIndex < 0) {
      result.correctAnswerIndex = null;
    }
  }

  return result;
}

function parseRecord(body, recordNum, inheritedLessonTitle = null) {
  const lines = body.split(/\r?\n/);
  let lessonTitle = inheritedLessonTitle;
  let pagePdf = null;
  let pagePrinted = null;
  let questionTypeField = '';
  let questionText = '';
  let answerText = '';
  let examReferencesRaw = '';
  let mode = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r?\n$/, '');
    const trimmed = line.trim();

    if (/^=+$/u.test(trimmed)) {
      continue;
    }

    const lessonMatch = trimmed.match(/^الدرس:\s*(.+)$/u);
    if (lessonMatch) {
      lessonTitle = lessonMatch[1].trim();
      continue;
    }

    const pagePdfMatch = trimmed.match(/PDF:\s*(\d+)/u);
    if (pagePdfMatch) {
      pagePdf = parseInteger(pagePdfMatch[1]);
      const pageNumbers = [...trimmed.matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (pageNumbers.length >= 2) pagePrinted = pageNumbers[pageNumbers.length - 1];
      continue;
    }

    const pageNumbers = [...trimmed.matchAll(/\d+/g)].map((m) => Number(m[0]));
    if (trimmed.includes("PDF:") && pageNumbers.length >= 2) {
      pagePrinted = pageNumbers[pageNumbers.length - 1];
    }

    const typeMatch = trimmed.match(/^نوع السؤال:\s*(.+)$/u);
    if (typeMatch) {
      questionTypeField = typeMatch[1].trim();
      mode = null;
      continue;
    }

    const questionMatch = trimmed.match(/^السؤال:\s*(.*)$/u);
    if (questionMatch) {
      mode = 'question';
      questionText = questionMatch[1] || '';
      continue;
    }

    const answerMatch = trimmed.match(/^الجواب:\s*(.*)$/u);
    if (answerMatch) {
      mode = 'answer';
      answerText = answerMatch[1] || '';
      continue;
    }

    const examMatch = trimmed.match(/^مراجع الامتحان:\s*(.*)$/u);
    if (examMatch) {
      mode = 'examReferences';
      examReferencesRaw = examMatch[1] || '';
      continue;
    }

    if (mode === 'question') {
      questionText += (questionText ? '\n' : '') + line;
    } else if (mode === 'answer') {
      answerText += (answerText ? '\n' : '') + line;
    } else if (mode === 'examReferences') {
      examReferencesRaw += (examReferencesRaw ? '\n' : '') + line;
    }
  }

  questionText = questionText.trim();
  answerText = answerText.trim();
  examReferencesRaw = examReferencesRaw.trim();

  const examReferences = extractExamReferences(examReferencesRaw, questionText, answerText);
  let questionType = normalizeQuestionType(questionTypeField, questionText);

  let blanks = [];
  let options = [];
  let correctAnswerIndex = null;
  let presentationClassification = undefined;

  if (questionType === 'fill') {
    const fill = replaceFillPlaceholders(questionText, answerText);
    questionText = fill.question;
    blanks = fill.blanks;
  }

  if (questionType === 'mcq') {
    const mcq = parseMcq(questionText, answerText);
    options = mcq.options;
    correctAnswerIndex = mcq.correctAnswerIndex;
  }

  if (questionType === 'drawing') {
    presentationClassification = 'DRAWING_UPLOAD_ONLY';
  }

  const id = `ch01-${String(recordNum).padStart(4, '0')}`;
  return {
    id,
    sourceRecord: recordNum,
    lessonTitle,
    sourceQuestionRaw: body,
    questionType,
    question: questionText,
    modelAnswer: answerText,
    examReferences,
    pagePdf,
    pagePrinted,
    blanks,
    options,
    correctAnswerIndex,
    presentationClassification,
    reviewFlags: {}
  };
}

function normalizeLessons(records) {
  let currentTitle = null;
  const titles = [];
  for (const rec of records) {
    if (rec.lessonTitle) {
      currentTitle = rec.lessonTitle;
      titles.push(currentTitle);
    }
    if (!rec.lessonTitle && currentTitle) {
      rec.lessonTitle = currentTitle;
    }
  }

  // Backfill earlier records if the first title appears later
  let lastKnown = null;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].lessonTitle) {
      lastKnown = records[i].lessonTitle;
    } else if (lastKnown) {
      records[i].lessonTitle = lastKnown;
    }
  }

  const uniqueLessons = [];
  for (const title of titles) {
    if (!uniqueLessons.includes(title)) uniqueLessons.push(title);
  }
  return uniqueLessons;
}

async function main() {
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    const metaRaw = fs.readFileSync(METADATA_FILE, 'utf8');
    const meta = JSON.parse(metaRaw || '{}');

    const lessonRegex = /الدرس:\s*(.+)/g;
    const lessonsInSource = [];
    let lessonMatch;
    while ((lessonMatch = lessonRegex.exec(raw)) !== null) {
      lessonsInSource.push({ title: lessonMatch[1].trim(), index: lessonMatch.index });
    }

    const re = /\[السجل\s+(\d{4})\]([\s\S]*?)(?=\[السجل\s+\d{4}\]|$)/g;
    const records = [];
    const unparsed = [];
    let m;
    while ((m = re.exec(raw)) !== null) {
      const recordNum = parseInt(m[1], 10);
      const body = (m[2] || '').trim();
      const lessonTitleEntry = lessonsInSource.filter(entry => entry.index < m.index).slice(-1)[0];
      const inheritedLessonTitle = lessonTitleEntry ? lessonTitleEntry.title : null;
      if (!body || body.includes('فاصل')) {
        unparsed.push({ recordNum, reason: 'empty or separator' });
        continue;
      }
      try {
        const record = parseRecord(body, recordNum, inheritedLessonTitle);
        records.push(record);
      } catch (error) {
        unparsed.push({ recordNum, reason: String(error) });
      }
    }

    if (records.length !== 444) {
      throw new Error(`Expected 444 records but got ${records.length}`);
    }
    if (unparsed.length > 0) {
      throw new Error(`${unparsed.length} records could not be parsed`);
    }

    const expectedSeq = Array.from({ length: 444 }, (_, i) => i + 1);
    const actualSeq = records.map(r => r.sourceRecord);
    if (JSON.stringify(expectedSeq) !== JSON.stringify(actualSeq)) {
      throw new Error('Record sequence is not 0001-0444 in order');
    }

    const lessons = normalizeLessons(records);
    for (const rec of records) {
      if (!rec.lessonTitle) {
        throw new Error(`Missing lessonTitle for record ${rec.sourceRecord}`);
      }
    }

    const fsPromises = await import('fs/promises');
    await fsPromises.mkdir(VER_DIR, { recursive: true });
    await fsPromises.writeFile(OUT_UNPARSED, JSON.stringify(unparsed, null, 2), 'utf8');

    const generationReport = {
      expectedRecords: 444,
      parsedRecords: records.length,
      unparsedRecords: unparsed.length,
      sourceQuestions: records.length,
      enrichmentQuestions: 0,
      firstRecord: records[0]?.sourceRecord || null,
      lastRecord: records[records.length - 1]?.sourceRecord || null
    };
    await fsPromises.writeFile(OUT_REPORT, JSON.stringify(generationReport, null, 2), 'utf8');

    const lessonCounts = {};
    for (const rec of records) {
      const lesson = rec.pagePdf ? `lesson-${rec.pagePdf}` : 'unknown';
      lessonCounts[lesson] = (lessonCounts[lesson] || 0) + 1;
    }
    await fsPromises.writeFile(OUT_LESSON_COUNTS, JSON.stringify(lessonCounts, null, 2), 'utf8');

    const data = {
      meta,
      lessons,
      sourceQuestions: records,
      enrichmentQuestions: []
    };

    const jsContent = `// GENERATED by scripts/generate-ch01-questions.mjs
// Total: ${records.length} records (0001-0444)
export const BIOLOGY_CHAPTER_01 = ${JSON.stringify(data, null, 2)};
`;

    await fsPromises.writeFile(OUT_JS, jsContent, 'utf8');
    console.log(JSON.stringify({ status: 'PASS', generated: records.length, unparsed: unparsed.length, file: OUT_JS }));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', error: String(error) }));
    process.exit(2);
  }
}

main();

