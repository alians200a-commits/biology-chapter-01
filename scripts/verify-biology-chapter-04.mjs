#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'ci';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function allFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(full) : [full];
  });
}

function loadLock() {
  const lockPath = path.join(root, 'verification/canonical-source-lock.json');
  assert(fs.existsSync(lockPath), 'ملف قفل المصدر canonical-source-lock.json مفقود');
  return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
}

async function verifyData() {
  const lock = loadLock();
  const release = lock.verifiedReleaseData;
  const questionsPath = path.join(root, 'assets/js/questions.js');
  const appPath = path.join(root, 'assets/js/app.js');
  const stylePath = path.join(root, 'assets/css/style.css');
  const indexPath = path.join(root, 'index.html');
  const pdfPath = path.join(root, 'app/applet/verification/BIOLOGY_CH04_SOURCE.pdf');
  const txtPath = path.join(root, 'app/applet/verification/BIOLOGY_CH04_CONTENT_MASTER.txt');

  for (const file of [questionsPath, appPath, stylePath, indexPath]) {
    assert(fs.existsSync(file), `ملف إصدار مفقود: ${path.relative(root, file)}`);
  }

  assert(sha256(questionsPath) === release.questionsJsSha256, 'بصمة questions.js لا تطابق قفل الإصدار المعتمد');
  assert(sha256(appPath) === release.appJsSha256, 'بصمة app.js لا تطابق قفل الإصدار المعتمد');
  assert(sha256(stylePath) === release.styleCssSha256, 'بصمة style.css لا تطابق قفل الإصدار المعتمد');
  assert(sha256(indexPath) === release.indexHtmlSha256, 'بصمة index.html لا تطابق قفل الإصدار المعتمد');

  const privateSourceFiles = [pdfPath, txtPath];
  if (mode === 'local') {
    for (const file of privateSourceFiles) {
      assert(fs.existsSync(file), `ملف مصدر خاص مفقود للفحص المحلي: ${path.relative(root, file)}`);
    }
    assert(sha256(pdfPath) === lock.canonicalSource.pdfSha256, 'بصمة PDF لا تطابق المصدر المعتمد');
    assert(sha256(txtPath) === lock.canonicalSource.txtSha256, 'بصمة TXT لا تطابق المصدر المعتمد');
  }
  if (isGitHubActions) {
    assert(privateSourceFiles.every(file => !fs.existsSync(file)), 'ملفات المصدر الخاصة PDF/TXT ممنوعة داخل المستودع العام');
  }

  const moduleUrl = `${pathToFileURL(questionsPath).href}?v=${Date.now()}`;
  const { BIOLOGY_CHAPTER_04 } = await import(moduleUrl);
  assert(BIOLOGY_CHAPTER_04?.meta?.subject === 'الأحياء', 'هوية المادة غير صحيحة');
  assert(BIOLOGY_CHAPTER_04?.meta?.chapterTitle === 'الفصل الرابع: الجهاز الهضمي', 'عنوان الفصل غير صحيح');

  const source = BIOLOGY_CHAPTER_04.sourceQuestions || [];
  const enrichment = BIOLOGY_CHAPTER_04.enrichmentQuestions || [];
  assert(source.length === release.sourceParents, `عدد الأسئلة الأصلية ${source.length} وليس ${release.sourceParents}`);
  assert(enrichment.length === release.enrichmentParents, `عدد الأسئلة الإثرائية ${enrichment.length} وليس ${release.enrichmentParents}`);

  const expectedSourceIds = Array.from({ length: release.sourceParents }, (_, index) => `ch04-source-${String(index + 1).padStart(3, '0')}`);
  const expectedSourceNums = Array.from({ length: release.sourceParents }, (_, index) => index + 1);
  const expectedEnrichmentIds = Array.from({ length: release.enrichmentParents }, (_, index) => `ch04-ENR-${String(index + 1).padStart(3, '0')}`);
  assert(JSON.stringify(source.map(record => record.id)) === JSON.stringify(expectedSourceIds), 'معرفات الأسئلة الأصلية ناقصة أو مكررة أو خارج الترتيب');
  assert(JSON.stringify(source.map(record => record.num)) === JSON.stringify(expectedSourceNums), 'أرقام الأسئلة الأصلية خارج الترتيب');
  assert(JSON.stringify(enrichment.map(record => record.id)) === JSON.stringify(expectedEnrichmentIds), 'معرفات الأسئلة الإثرائية ناقصة أو مكررة أو خارج الترتيب');

  const records = [];
  let childCount = 0;
  for (const parent of [...source, ...enrichment]) {
    records.push(parent);
    assert(parent.id && parent.question && parent.presentationClassification, `سجل غير مكتمل: ${parent.id || 'UNKNOWN'}`);
    if (Array.isArray(parent.subItems)) {
      childCount += parent.subItems.length;
      for (const child of parent.subItems) {
        records.push(child);
        assert(child.id && child.question && child.presentationClassification, `فرع غير مكتمل: ${child.id || 'UNKNOWN'}`);
      }
    }
  }
  assert(childCount === release.internalChildren, `عدد الفروع الداخلية ${childCount} وليس ${release.internalChildren}`);
  assert(records.length === release.totalRecords, `إجمالي السجلات ${records.length} وليس ${release.totalRecords}`);
  assert(new Set(records.map(record => record.id)).size === records.length, 'توجد معرفات مكررة');

  for (const record of records) {
    if (record.modelAnswerPresentation?.mode === 'table') {
      const table = record.modelAnswerPresentation.table;
      assert(Array.isArray(table?.headers) && Array.isArray(table?.rows), `عقد جدول غير صالح: ${record.id}`);
      const width = table.headers.length || table.rows[0]?.length || 0;
      assert(width > 0, `جدول بلا أعمدة: ${record.id}`);
      for (const row of table.rows) assert(row.length === width, `صف غير مستطيل في ${record.id}`);
    }
    if (record.questionType === 'fill') {
      const dotRuns = record.question.match(/\.{3,}/g) || [];
      assert(dotRuns.length === (record.blanks?.length || 0), `عدد مواضع الفراغ لا يطابق الإجابات في ${record.id}`);
    }
    if (record.questionType === 'fixed-underlined-true-false') {
      for (const segment of record.displayFixedSegments || []) {
        assert(record.question.includes(segment), `الجزء المسطر غير موجود في سؤال ${record.id}`);
        assert(record.modelAnswer.includes(segment), `الجواب الصحيح لا يتضمن الجزء الثابت في ${record.id}`);
      }
    }
  }

  const byId = Object.fromEntries(records.map(record => [record.id, record]));
  assert(byId['ch04-source-044']?.question === 'عرّف الهضم.', 'سؤال عرّف الهضم مفقود أو في غير موضعه');
  assert(byId['ch04-source-044']?.modelAnswer === 'هو عملية تحويل المواد الغذائية معقدة التركيب إلى مواد بسيطة يسهل امتصاصها.', 'جواب تعريف الهضم غير مطابق للمصدر');
  assert(byId['ch04-source-009']?.modelAnswer.includes('الفتحة السفلى للمعدة'), 'جواب السؤال 9 ما زال يذكر الفتحة العليا خطأً');
  assert(byId['ch04-source-010']?.modelAnswer.startsWith('كيس عضلي يقع'), 'جواب تعريف المعدة غير مطابق للمصدر');
  assert(byId['ch04-source-056']?.question === 'هل تعد زيادة كمية الأملاح في الغذاء مثل نقصانها؟', 'صياغة سؤال الأملاح غير مطابقة للمصدر');
  assert(byId['ch04-source-073']?.question === 'اختر الإجابة الصحيحة:', 'عنوان سؤال الاختيار غير مطابق للمصدر');
  assert(byId['ch04-source-075']?.question === 'صحح العبارات الآتية:', 'عنوان سؤال التصحيح غير مطابق للمصدر');
  assert(byId['ch04-source-075-02']?.question === 'يبدأ هضم النشويات في الأمعاء الدقيقة.', 'العبارة الثانية في سؤال التصحيح غير مطابقة للمصدر');
  assert(byId['ch04-ENR-001']?.question === 'أي عضو يبدأ فيه الهضم الميكانيكي والكيميائي للطعام؟', 'صياغة ENR-001 غير مطابقة للمصدر الإثرائي المعتمد');
  assert(byId['ch04-ENR-019']?.modelAnswer === 'لأن الزائدة الدودية أنبوبة صغيرة مغلقة متصلة بالأعور، ويسبب التهابها ألمًا ومغصًا شديدًا.', 'جواب ENR-019 غير مطابق للمصدر الإثرائي المعتمد');

  const drawingIds = source.filter(record => record.questionType === 'drawing').map(record => record.id);
  assert(JSON.stringify(drawingIds) === JSON.stringify(['ch04-source-005', 'ch04-source-022', 'ch04-source-036', 'ch04-source-050']), 'أسئلة الرسم الأصلية ليست في مواضعها الأربعة المعتمدة');
  assert(enrichment.every(record => record.questionType !== 'drawing'), 'يوجد سؤال رسم إثرائي غير مسموح');

  const appSource = fs.readFileSync(appPath, 'utf8');
  const indexSource = fs.readFileSync(indexPath, 'utf8');
  for (const token of [
    "from 'lucide'",
    "replace(/\\.{3,}/g",
    "data-fill-index",
    "rating_8_10",
    "rating_5_7",
    "rating_1_4",
    'school_biology_ch04_digestive_system_v2',
    'biology_drawings_db_ch04',
    'student_drawings_ch04',
    'تأكد من دقة الرسم والتأشيرات في كتابك المنهجي'
  ]) {
    assert(appSource.includes(token), `متطلب برمجي مفقود: ${token}`);
  }
  for (const forbidden of [
    'الفراغ (',
    'window.lucide',
    'localStorage.clear(',
    'scrollIntoView',
    'window.scrollTo',
    '.scrollTo(',
    'autoFocus',
    'mastered',
    'not_mastered'
  ]) {
    assert(!appSource.includes(forbidden), `سلوك أو واجهة ممنوعة موجودة: ${forbidden}`);
  }
  for (const network of ['fetch(', 'XMLHttpRequest', 'FormData(', 'axios', 'firebase', 'supabase']) {
    assert(!appSource.toLowerCase().includes(network.toLowerCase()), `عملية شبكة ممنوعة: ${network}`);
  }
  assert(!/https?:\/\/[^"']+\.js/i.test(indexSource), 'index.html يعتمد على سكربت خارجي');
  assert(indexSource.includes('href="./assets/css/style.css"'), 'مسار CSS النسبي غير موجود');
  assert(indexSource.includes('src="./assets/js/app.js"'), 'مسار JavaScript النسبي غير موجود');

  return {
    status: 'PASS',
    mode,
    generatedAt: new Date().toISOString(),
    privacy: isGitHubActions ? 'PRIVATE_SOURCES_ABSENT' : 'PRIVATE_SOURCES_AVAILABLE_LOCALLY',
    counts: {
      sourceParents: source.length,
      sourceFormulas: release.sourceFormulas,
      enrichmentParents: enrichment.length,
      internalChildren: childCount,
      totalRecords: records.length
    },
    hashes: {
      questions: sha256(questionsPath),
      app: sha256(appPath),
      style: sha256(stylePath),
      index: sha256(indexPath)
    }
  };
}

function verifyBuild() {
  const dist = path.join(root, 'dist');
  assert(fs.existsSync(path.join(dist, 'index.html')), 'dist/index.html غير موجود');
  const files = allFiles(dist).map(file => path.relative(dist, file).replaceAll('\\', '/'));
  const forbidden = files.filter(file => /BIOLOGY_CH04_SOURCE|BIOLOGY_CH04_CONTENT_MASTER|verification|\.pdf$|\.txt$/i.test(file));
  assert(forbidden.length === 0, `ملفات خاصة ممنوعة داخل dist: ${forbidden.join(', ')}`);
  const indexSource = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert(!/https:\/\/unpkg\.com/i.test(indexSource), 'نسخة الإنتاج ما زالت تعتمد على Lucide CDN');
  return { status: 'PASS', mode: 'postbuild', generatedAt: new Date().toISOString(), distFiles: files };
}

try {
  const report = mode === 'postbuild' ? verifyBuild() : await verifyData();
  if (mode === 'local') {
    const dir = path.join(root, 'verification');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chapter-04-verification.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'chapter-04-verification.md'), `# Chapter 04 Verification\n\n- Status: **${report.status}**\n- Source parents: **${report.counts.sourceParents}**\n- Canonical source formulas: **${report.counts.sourceFormulas}**\n- Enrichment parents: **${report.counts.enrichmentParents}**\n- Internal children: **${report.counts.internalChildren}**\n- Total records: **${report.counts.totalRecords}**\n`);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`VERIFY FAILED: ${error.message}`);
  process.exit(1);
}
