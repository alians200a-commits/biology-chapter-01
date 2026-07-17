import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const SOURCE_TXT = path.join(ROOT, 'source-private', 'BIOLOGY_CH01_CONTENT_MASTER.txt');
const QUESTIONS_FILE = path.join(ROOT, 'assets', 'js', 'questions.js');
const VER_DIR = path.join(ROOT, 'verification');
const LESSON_TITLE_AUDIT = path.join(VER_DIR, 'lesson-title-audit.json');
const RECORD_FIELD_AUDIT = path.join(VER_DIR, 'record-field-audit.json');
const SAMPLE_RECORDS_AUDIT = path.join(VER_DIR, 'sample-records-audit.txt');
const EXAM_REFERENCES_AUDIT = path.join(VER_DIR, 'exam-references-audit.json');
const QUESTION_TYPE_COUNTS = path.join(VER_DIR, 'question-type-counts.json');
const DETERMINISM_REPORT = path.join(VER_DIR, 'determinism-report.txt');

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

const TOKEN_SEARCH = [
  'ch04',
  'BIOLOGY_CHAPTER_04',
  'الفصل الرابع',
  'الجهاز الهضمي',
  'madrasati-biology-chapter-04'
];

const KNOWN_REFERENCE_TERMS = [
  'أسئلة الفصل',
  'أسئلة التلفزيون التربوي',
  'خارج القطر',
  'تمهيدي',
  'تكميلي',
  'المتميزين',
  'النازحين'
];

function hashFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readSourceLines() {
  const raw = fs.readFileSync(SOURCE_TXT, 'utf8');
  const lines = raw.split(/\r?\n/);
  const lessonTitles = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('الدرس:')) {
      lessonTitles.push(trimmed.substring(6).trim());
    }
  }
  return { raw, lines, lessonTitles };
}

function splitSourceRecords(raw) {
  const regex = /\[السجل\s+(\d{4})\]([\s\S]*?)(?=\[السجل\s+\d{4}\]|$)/g;
  const records = [];
  let match;
  while ((match = regex.exec(raw)) !== null) {
    records.push({
      sourceRecord: Number(match[1]),
      body: (match[2] || '').replace(/\s+$/, '')
    });
  }
  return records;
}

async function loadGeneratedData() {
  const module = await import(pathToFileURL(QUESTIONS_FILE).href);
  return module.BIOLOGY_CHAPTER_01;
}

function compareArrays(a, b) {
  const missingTitles = a.filter(title => !b.includes(title));
  const extraTitles = b.filter(title => !a.includes(title));
  const orderMatches = a.length === b.length && a.every((title, index) => title === b[index]);
  return { missingTitles, extraTitles, orderMatches };
}

function searchTokensInProject() {
  const results = [];
  const excludedDirs = new Set(['node_modules', 'dist', '.git']);
  const excludedFiles = new Set([
    'verification/baseline-report.txt',
    '01_VSCODE_MASTER_INSTRUCTIONS.txt',
    '05_ACCEPTANCE_CHECKLIST.txt',
    'package-lock.json',
    'scripts/audit-biology-chapter-01.mjs',
    'scripts/verify-biology-chapter-04.mjs'
  ]);
  const allowedExtensions = new Set(['.js', '.mjs', '.json', '.html', '.htm', '.md', '.txt', '.ts', '.css']);

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(ROOT, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) walk(fullPath);
        continue;
      }
      if (excludedFiles.has(relPath)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(ext)) continue;
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const token of TOKEN_SEARCH) {
          const regex = new RegExp(token, 'g');
          if (regex.test(content)) {
            results.push({ file: relPath, token });
          }
        }
      } catch {
        // ignore unreadable files
      }
    }
  }

  walk(ROOT);
  return results;
}

function getQuestionTypeCounts(records) {
  const counts = {};
  for (const type of SUPPORTED_TYPES) counts[type] = 0;
  const fillIssues = [];
  const mcqIssues = [];
  const drawingIssues = [];

  for (const rec of records) {
    const type = rec.questionType;
    if (counts[type] === undefined) counts[type] = 0;
    counts[type] += 1;

    if (type === 'fill') {
      const placeholderCount = (rec.question.match(/____+/g) || []).length;
      if (!Array.isArray(rec.blanks) || rec.blanks.length === 0) {
        fillIssues.push({ id: rec.id, issue: 'fill blanks missing' });
      } else if (rec.blanks.some(blank => !blank.trim())) {
        fillIssues.push({ id: rec.id, issue: 'empty blank entry' });
      } else if (placeholderCount !== rec.blanks.length) {
        fillIssues.push({ id: rec.id, issue: `placeholder count ${placeholderCount} != blanks length ${rec.blanks.length}` });
      }
    }

    if (type === 'mcq') {
      if (!Array.isArray(rec.options) || rec.options.length < 2) {
        mcqIssues.push({ id: rec.id, issue: 'options missing or fewer than 2' });
      }
      if (!Number.isInteger(rec.correctAnswerIndex) || rec.correctAnswerIndex < 0 || rec.correctAnswerIndex >= (rec.options || []).length) {
        mcqIssues.push({ id: rec.id, issue: 'correctAnswerIndex invalid' });
      }
    }

    if (type === 'drawing') {
      if (rec.modelAnswer && rec.modelAnswer.trim().length === 0) {
        // allowed
      }
      if (rec.presentationClassification !== 'DRAWING_UPLOAD_ONLY') {
        drawingIssues.push({ id: rec.id, issue: 'missing presentationClassification DRAWING_UPLOAD_ONLY' });
      }
    }
  }

  return { counts, fillIssues, mcqIssues, drawingIssues };
}

function extractExamReferenceCounts(records) {
  const counts = {
    recordsWithExamReferences: 0,
    totalExamReferenceItems: 0,
    emptyRawCount: 0,
    rawWithDigits: 0,
    metadataSourceCounts: {}
  };
  for (const term of KNOWN_REFERENCE_TERMS) counts.metadataSourceCounts[term] = 0;

  for (const rec of records) {
    const refs = Array.isArray(rec.examReferences) ? rec.examReferences : [];
    if (refs.length > 0) counts.recordsWithExamReferences += 1;
    counts.totalExamReferenceItems += refs.length;
    for (const ref of refs) {
      const raw = String(ref.raw || '').trim();
      if (!raw) counts.emptyRawCount += 1;
      if (/\d/.test(raw)) counts.rawWithDigits += 1;
      for (const term of KNOWN_REFERENCE_TERMS) {
        if (raw.includes(term)) counts.metadataSourceCounts[term] += 1;
      }
    }
  }

  return counts;
}

function sanitizeLine(value) {

  return JSON.stringify(value ?? '').replace(/\r/g, '').replace(/\n/g, '\\n');
}

function validateRecordFields(records, sourceRecords) {
  const failures = [];
  const sourceMap = new Map(sourceRecords.map(r => [r.sourceRecord, r.body]));

  for (let expected = 1; expected <= 444; expected += 1) {
    const rec = records.find(r => r.sourceRecord === expected);
    const raw = sourceMap.get(expected);
    if (!rec) {
      failures.push({ sourceRecord: expected, issue: 'missing record' });
      continue;
    }
    if (!rec.lessonTitle || !String(rec.lessonTitle).trim()) failures.push({ sourceRecord: expected, issue: 'lessonTitle empty' });
    if (!Number.isInteger(rec.pagePdf)) failures.push({ sourceRecord: expected, issue: 'pagePdf not integer' });
    if (rec.pagePrinted !== null && !Number.isInteger(rec.pagePrinted)) failures.push({ sourceRecord: expected, issue: 'pagePrinted not integer or null' });
    if (!String(rec.question || '').trim()) failures.push({ sourceRecord: expected, issue: 'question empty' });
    if (!String(rec.sourceQuestionRaw || '').trim()) failures.push({ sourceRecord: expected, issue: 'sourceQuestionRaw empty' });
    if (!raw || raw.trim() !== rec.sourceQuestionRaw.trim()) failures.push({ sourceRecord: expected, issue: 'sourceQuestionRaw does not match source text' });
    if (rec.questionType !== 'drawing' && !String(rec.modelAnswer || '').trim()) failures.push({ sourceRecord: expected, issue: 'modelAnswer empty for non-drawing record' });
    if (!SUPPORTED_TYPES.includes(rec.questionType)) failures.push({ sourceRecord: expected, issue: `questionType invalid: ${rec.questionType}` });
    if (!Array.isArray(rec.examReferences)) failures.push({ sourceRecord: expected, issue: 'examReferences is not array' });
    else if (rec.examReferences.length === 0) failures.push({ sourceRecord: expected, issue: 'examReferences empty array' });
    else {
      rec.examReferences.forEach((ref, index) => {
        if (!String(ref?.raw || '').trim()) failures.push({ sourceRecord: expected, issue: `examReferences[${index}].raw empty` });
      });
    }

    const badTokens = ['undefined', '\[object Object\]', 'NaN', '\[\[UNCLEAR\]\]', 'راجع السؤال السابق', 'نفس الجواب', 'كما سبق'];
    const checkText = `${rec.question}\n${rec.modelAnswer}`;
    for (const token of badTokens) {
      const regex = new RegExp(token, 'i');
      if (regex.test(checkText)) failures.push({ sourceRecord: expected, issue: `contains banned token ${token}` });
    }
  }

  return failures;
}

function buildSampleAudit(records) {
  const sampleIds = ['0001','0008','0013','0017','0034','0056','0100','0150','0200','0250','0300','0350','0400','0444'];
  const sampleRecords = [];
  for (const id of sampleIds) {
    const rec = records.find(r => r.id === `ch01-${id}`);
    if (!rec) {
      sampleRecords.push({ id, missing: true });
      continue;
    }
    sampleRecords.push({
      id: rec.id,
      lessonTitle: rec.lessonTitle,
      pagePdf: rec.pagePdf,
      pagePrinted: rec.pagePrinted,
      questionType: rec.questionType,
      sourceQuestionRaw: rec.sourceQuestionRaw,
      question: rec.question,
      modelAnswer: rec.modelAnswer,
      examReferences: rec.examReferences
    });
  }
  return sampleRecords;
}

function writeSampleRecordsAudit(records) {
  const sample = buildSampleAudit(records);
  const lines = [];
  for (const item of sample) {
    lines.push(`RECORD ${item.id}`);
    if (item.missing) {
      lines.push('  MISSING');
      lines.push('');
      continue;
    }
    lines.push(`lessonTitle: ${item.lessonTitle}`);
    lines.push(`pagePdf: ${item.pagePdf}`);
    lines.push(`pagePrinted: ${item.pagePrinted}`);
    lines.push(`questionType: ${item.questionType}`);
    lines.push('sourceQuestionRaw:');
    lines.push(item.sourceQuestionRaw);
    lines.push('question:');
    lines.push(item.question);
    lines.push('modelAnswer:');
    lines.push(item.modelAnswer);
    lines.push('examReferences:');
    for (const ref of item.examReferences) {
      lines.push(`  - raw: ${ref.raw}`);
    }
    lines.push('');
  }
  fs.writeFileSync(SAMPLE_RECORDS_AUDIT, lines.join('\n'), 'utf8');
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function runGenerateForDeterminism() {
  const env = { ...process.env };
  const command = `node scripts/generate-ch01-questions.mjs`;
  execSync(command, { cwd: ROOT, env, stdio: 'pipe' });
}

export async function runAudit() {
  fs.mkdirSync(VER_DIR, { recursive: true });

  const source = readSourceLines();
  const sourceRecords = splitSourceRecords(source.raw);
  const sourceLessonTitles = source.lessonTitles;

  const data = await loadGeneratedData();
  const generatedLessons = Array.isArray(data.lessons) ? data.lessons : [];
  const lessonComparison = compareArrays(sourceLessonTitles, generatedLessons);

  writeJson(LESSON_TITLE_AUDIT, {
    sourceLessonCount: sourceLessonTitles.length,
    generatedLessonCount: generatedLessons.length,
    sourceTitles: sourceLessonTitles,
    generatedTitles: generatedLessons,
    missingTitles: lessonComparison.missingTitles,
    extraTitles: lessonComparison.extraTitles,
    orderMatches: lessonComparison.orderMatches
  });

  const recordFailures = validateRecordFields(data.sourceQuestions, sourceRecords);
  writeJson(RECORD_FIELD_AUDIT, {
    total: 444,
    passed: 444 - recordFailures.length,
    failed: recordFailures.length,
    failures: recordFailures
  });

  writeSampleRecordsAudit(data.sourceQuestions);

  const examStats = extractExamReferenceCounts(data.sourceQuestions);
  writeJson(EXAM_REFERENCES_AUDIT, examStats);

  const qTypeStats = getQuestionTypeCounts(data.sourceQuestions);
  writeJson(QUESTION_TYPE_COUNTS, qTypeStats);

  const tokenMatches = searchTokensInProject();
  if (tokenMatches.length > 0) {
    throw new Error(`Token search found forbidden values in project: ${JSON.stringify(tokenMatches.slice(0, 20), null, 2)}`);
  }

  // Determinism
  runGenerateForDeterminism();
  const firstHash = hashFile(QUESTIONS_FILE);
  runGenerateForDeterminism();
  const secondHash = hashFile(QUESTIONS_FILE);
  const deterministic = firstHash === secondHash;
  fs.writeFileSync(DETERMINISM_REPORT, `firstHash=${firstHash}\nsecondHash=${secondHash}\ndeterministic=${deterministic}\n`, 'utf8');

  if (lessonComparison.missingTitles.length > 0 || lessonComparison.extraTitles.length > 0 || !lessonComparison.orderMatches) {
    throw new Error('Lesson titles do not match source exactly');
  }
  if (recordFailures.length > 0) {
    throw new Error('Record field audit failed');
  }
  if (!deterministic) {
    throw new Error('questions.js generation is not deterministic');
  }
  if (examStats.emptyRawCount > 0) {
    throw new Error('Some examReferences.raw values are empty');
  }

  return {
    lessonAudit: lessonComparison,
    recordFailuresCount: recordFailures.length,
    deterministic,
    firstHash,
    secondHash,
    tokenMatchesCount: tokenMatches.length,
    examStats,
    questionTypeCounts: qTypeStats.counts
  };
}
