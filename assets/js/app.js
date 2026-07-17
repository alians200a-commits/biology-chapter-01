import { BIOLOGY_CHAPTER_01 } from './questions.js';
import {
  createIcons,
  Home,
  Award,
  BookOpen,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Check,
  Eye,
  Camera,
  Trash2,
  Info
} from 'lucide';

const LOCAL_LUCIDE_ICONS = {
  Home,
  Award,
  BookOpen,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Check,
  Eye,
  Camera,
  Trash2,
  Info
};

window.BIOLOGY_CHAPTER_01 = BIOLOGY_CHAPTER_01;

const STORAGE_KEY = 'school_biology_ch01_cell_v2';
const DB_NAME = 'biology_drawings_db_ch01';
const STORE_NAME = 'student_drawings_ch01';
const DB_VERSION = 1;
const DRAWING_NOTICE = 'تأكد من دقة الرسم والتأشيرات في كتابك المنهجي';

const EMPTY_STATE = () => ({
  answers: {},
  shownAnswers: {},
  ratings: {},
  fillAnswers: {},
  tfAnswers: {},
  mcqAnswers: {}
});

let appState = EMPTY_STATE();
let currentScreen = 'home';
let activeSection = 'source';
let activeIdx = 0;
let currentFilter = 'all';
let drawingImages = {};
let showResetConfirm = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, '&#10;');
}

function renderUnderlinedText(text, segments = []) {
  const clean = String(text ?? '').replace(/<\/?u>/gi, '');
  if (!segments.length) return escapeHtml(clean);

  const found = segments
    .map(segment => ({ segment, index: clean.indexOf(segment) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (found.length !== segments.length) return escapeHtml(clean);

  let html = '';
  let cursor = 0;
  for (const item of found) {
    if (item.index < cursor) continue;
    html += escapeHtml(clean.slice(cursor, item.index));
    html += `<span class="source-required-underline">${escapeHtml(item.segment)}</span>`;
    cursor = item.index + item.segment.length;
  }
  html += escapeHtml(clean.slice(cursor));
  return html;
}

  function recordKey(id) {
  return `ch01:${id}`;
}

function sanitizeMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function loadAppState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const restored = EMPTY_STATE();
    restored.answers = sanitizeMap(parsed.answers);
    restored.shownAnswers = sanitizeMap(parsed.shownAnswers);
    restored.fillAnswers = sanitizeMap(parsed.fillAnswers);
    restored.tfAnswers = sanitizeMap(parsed.tfAnswers);
    restored.mcqAnswers = sanitizeMap(parsed.mcqAnswers);
    const ratings = sanitizeMap(parsed.ratings);
    for (const [id, value] of Object.entries(ratings)) {
      if (Number.isInteger(value) && value >= 1 && value <= 10) restored.ratings[id] = value;
    }
    appState = restored;
  } catch (error) {
    console.error('تعذر استعادة بيانات الفصل الأول:', error);
    appState = EMPTY_STATE();
  }
}

function saveAppState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDrawingImage(id, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(dataUrl, recordKey(id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteDrawingImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(recordKey(id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function clearChapterDrawings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadAllDrawings() {
  drawingImages = {};
  try {
    const db = await openDB();
    await new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).openCursor();
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return resolve();
        const key = String(cursor.key);
        if (key.startsWith('ch01:')) drawingImages[key.slice(5)] = cursor.value;
        cursor.continue();
      };
      request.onerror = resolve;
    });
  } catch (error) {
    console.error('تعذر استعادة رسومات الفصل الأول:', error);
  }
}

function allMainQuestions() {
  return [...BIOLOGY_CHAPTER_01.sourceQuestions, ...BIOLOGY_CHAPTER_01.enrichmentQuestions];
}

function isQuestionAttempted(record) {
  if (!record) return false;
  if (record.questionType === 'multi-part') {
    return Array.isArray(record.subItems) && record.subItems.length > 0 && record.subItems.every(isQuestionAttempted);
  }
  if (['written', 'comparison', 'list'].includes(record.questionType)) {
    return String(appState.answers[record.id] || '').trim().length > 0;
  }
  if (record.questionType === 'fill') {
    const expected = record.blanks?.length || 0;
    const values = appState.fillAnswers[record.id] || [];
    return expected > 0 && values.length >= expected && values.slice(0, expected).every(value => String(value || '').trim());
  }
  if (record.questionType === 'mcq') return Number.isInteger(appState.mcqAnswers[record.id]);
  if (['true-false-correction', 'fixed-underlined-true-false'].includes(record.questionType)) {
    const state = appState.tfAnswers[record.id];
    if (!state || typeof state.selected !== 'boolean') return false;
    return state.selected || String(state.correction || '').trim().length > 0;
  }
  if (record.questionType === 'drawing') return Boolean(drawingImages[record.id]);
  return false;
}

function hasRevealableAnswer(record) {
  if (!record || record.questionType === 'drawing') return false;
  if (record.questionType === 'multi-part') return (record.subItems || []).some(hasRevealableAnswer);
  if (record.modelAnswerPresentation) return true;
  if (record.questionType === 'fill') return (record.blanks || []).length > 0;
  return String(record.modelAnswer || '').trim().length > 0;
}

function getSectionQuestions() {
  return activeSection === 'source' ? BIOLOGY_CHAPTER_01.sourceQuestions : BIOLOGY_CHAPTER_01.enrichmentQuestions;
}

function getFilteredQuestions() {
  return getSectionQuestions().filter(question => {
    if (currentFilter === 'unanswered') return !isQuestionAttempted(question);
    if (currentFilter === 'unrated') return appState.ratings[question.id] === undefined;
    const rating = appState.ratings[question.id];
    if (currentFilter === 'rating_8_10') return Number.isInteger(rating) && rating >= 8 && rating <= 10;
    if (currentFilter === 'rating_5_7') return Number.isInteger(rating) && rating >= 5 && rating <= 7;
    if (currentFilter === 'rating_1_4') return Number.isInteger(rating) && rating >= 1 && rating <= 4;
    return true;
  });
}

function safeAction(callback) {
  return function handler(event) {
    if (event?.preventDefault && !['TEXTAREA', 'INPUT'].includes(event.target?.tagName)) event.preventDefault();
    return callback.apply(this, arguments);
  };
}

function renderAnswerContent(record) {
  const presentation = record.modelAnswerPresentation;

  if (record.questionType === 'fill' && !presentation) {
    return `<ol class="list-decimal pr-6 space-y-2 text-sm font-medium leading-relaxed">${(record.blanks || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
  }

  if (presentation?.mode === 'table') {
    const headers = presentation.table?.headers || [];
    const rows = presentation.table?.rows || [];
    return `
      <div class="w-full overflow-x-auto no-scrollbar" dir="rtl">
        <table class="w-full min-w-[520px] border-collapse text-right text-xs md:text-sm model-answer-text">
          ${headers.length ? `<thead><tr>${headers.map(header => `<th class="border border-green-200 bg-green-100/80 px-3 py-2.5 font-black text-green-900 align-top">${escapeHtml(header)}</th>`).join('')}</tr></thead>` : ''}
          <tbody>${rows.map(row => `<tr>${row.map(cell => `<td class="border border-green-200 px-3 py-2.5 font-medium leading-relaxed align-top whitespace-normal">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  if (presentation?.mode === 'ordered-list' || presentation?.mode === 'unordered-list') {
    const tag = presentation.mode === 'ordered-list' ? 'ol' : 'ul';
    const marker = presentation.mode === 'ordered-list' ? 'list-decimal' : 'list-disc';
    return `<${tag} class="${marker} pr-6 space-y-2 text-sm font-medium leading-relaxed model-answer-text">${(presentation.items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
  }

  if (presentation?.mode === 'sections') {
    return `<div class="flex flex-col gap-4">${(presentation.sections || []).map(section => {
      const items = section.items || [];
      const tag = section.listType === 'ordered' ? 'ol' : 'ul';
      const marker = section.listType === 'ordered' ? 'list-decimal' : 'list-disc';
      return `<section class="rounded-xl border border-green-200/70 bg-white/60 p-3.5">
        <h5 class="text-sm font-black text-green-800 mb-2">${escapeHtml(section.title)}</h5>
        ${section.text ? `<p class="text-sm font-medium leading-relaxed whitespace-pre-wrap model-answer-text">${escapeHtml(section.text)}</p>` : ''}
        ${items.length ? `<${tag} class="${marker} pr-6 space-y-2 text-sm font-medium leading-relaxed model-answer-text">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>` : ''}
      </section>`;
    }).join('')}</div>`;
  }

  if (presentation?.mode === 'flow') {
    return `<div class="flex flex-wrap items-center justify-start gap-2 text-sm font-black leading-relaxed model-answer-text" dir="rtl">${(presentation.flow || []).map((item, index, arr) => `<span class="inline-flex items-center gap-2"><span class="rounded-lg border border-green-200 bg-white px-3 py-2">${escapeHtml(item)}</span>${index < arr.length - 1 ? '<span class="text-green-700 text-lg">←</span>' : ''}</span>`).join('')}</div>`;
  }

  const answer = String(record.modelAnswer || '');
  if (record.questionType === 'fixed-underlined-true-false') {
    return `<p class="model-answer-text text-sm font-medium leading-relaxed whitespace-pre-wrap">${renderUnderlinedText(answer, record.displayFixedSegments || [])}</p>`;
  }
  return `<p class="model-answer-text text-sm font-medium leading-relaxed whitespace-pre-wrap">${escapeHtml(answer)}</p>`;
}

function renderCorrectionControls(record, disabled = false) {
  const state = appState.tfAnswers[record.id] || {};
  const selected = state.selected;
  return `
    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-3">
        <button type="button" data-tf-id="${record.id}" data-tf-value="true" class="tf-choice py-3 rounded-xl border text-sm font-black transition-all ${selected === true ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-borders text-muted-text hover:border-green-500'}" ${disabled ? 'disabled' : ''}>صح ✓</button>
        <button type="button" data-tf-id="${record.id}" data-tf-value="false" class="tf-choice py-3 rounded-xl border text-sm font-black transition-all ${selected === false ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-borders text-muted-text hover:border-red-500'}" ${disabled ? 'disabled' : ''}>خطأ ×</button>
      </div>
      ${selected === false ? `<textarea data-correction-id="${record.id}" rows="3" placeholder="اكتب التصحيح هنا..." class="correction-input w-full p-3 rounded-xl border border-borders bg-white focus:border-primary-purple focus:outline-none text-sm leading-relaxed" ${disabled ? 'disabled' : ''}>${escapeHtml(state.correction || '')}</textarea>` : ''}
    </div>`;
}

function renderStudentInput(record, shown = false, isChild = false) {
  if (['written', 'comparison', 'list'].includes(record.questionType)) {
    return `<textarea data-written-id="${record.id}" rows="${isChild ? 3 : 4}" placeholder="اكتب إجابتك هنا..." class="written-input w-full p-3 rounded-xl border border-borders bg-white focus:border-primary-purple focus:outline-none text-sm leading-relaxed" ${shown ? 'disabled' : ''}>${escapeHtml(appState.answers[record.id] || '')}</textarea>`;
  }

  if (record.questionType === 'fill') {
    const values = appState.fillAnswers[record.id] || [];
    const totalBlanks = record.blanks?.length || 0;
    const rawQuestion = String(record.question || '');
    const promptText = rawQuestion.replace(/^املأ الفراغات:\s*\n?/, '');
    let blankIndex = 0;
    let promptHtml = escapeHtml(promptText).replace(/\.{3,}/g, match => {
      if (blankIndex >= totalBlanks) return match;
      const index = blankIndex;
      blankIndex += 1;
      return `<input type="text" data-fill-id="${record.id}" data-fill-index="${index}" value="${escapeAttr(values[index] || '')}" placeholder="..." class="fill-input inline-block w-32 max-w-full px-2.5 py-1.5 mx-1 rounded-lg border border-borders bg-white focus:border-primary-purple focus:outline-none focus:ring-2 focus:ring-primary-purple/20 text-sm align-middle" ${shown ? 'disabled' : ''}>`;
    });
    promptHtml = promptHtml.replace(/\n/g, '<br />');
    return `<div class="bg-page-bg/40 border border-borders/60 rounded-2xl p-4 text-sm font-serif leading-[2.6] text-main-text" dir="rtl">${promptHtml}</div>`;
  }

  if (record.questionType === 'mcq') {
    const selected = appState.mcqAnswers[record.id];
    return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${(record.options || []).map((option, index) => `<button type="button" data-mcq-id="${record.id}" data-mcq-index="${index}" class="mcq-choice text-right p-3 rounded-xl border transition-all text-sm font-extrabold ${selected === index ? 'bg-primary-purple border-primary-purple text-white shadow-sm' : 'bg-white border-borders text-muted-text hover:border-primary-purple'}" ${shown ? 'disabled' : ''}>${escapeHtml(option)}</button>`).join('')}</div>`;
  }

  if (['true-false-correction', 'fixed-underlined-true-false'].includes(record.questionType)) return renderCorrectionControls(record, shown);

  return '';
}

function renderMultiPartInput(question, shown) {
  return `<div class="flex flex-col gap-4">
    ${question.interactionHelper ? `<p class="text-xs font-black text-muted-text">${escapeHtml(question.interactionHelper)}</p>` : '<p class="text-xs font-black text-muted-text">أجب عن كل مطلب مستقل أدناه:</p>'}
    ${(question.subItems || []).map((sub, index) => `<div class="border border-borders/80 bg-page-bg/20 rounded-2xl p-4 md:p-5 flex flex-col gap-3">
      <h3 class="text-sm font-black text-main-text leading-relaxed whitespace-pre-wrap">${sub.questionType === 'fixed-underlined-true-false' ? renderUnderlinedText(sub.question, sub.displayFixedSegments || []) : escapeHtml(sub.question)}</h3>
      ${renderStudentInput(sub, shown, true)}
      ${shown && hasRevealableAnswer(sub) ? `<div class="bg-green-50/70 border border-green-200 rounded-xl p-3.5 mt-1"><span class="text-xs font-black text-green-700">الجواب النموذجي للمطلب (${index + 1}):</span><div class="mt-2">${renderAnswerContent(sub)}</div></div>` : ''}
    </div>`).join('')}
  </div>`;
}

function renderQuestionTitle(question) {
  if (question.questionType === 'fixed-underlined-true-false') return renderUnderlinedText(question.question, question.displayFixedSegments || []);
  return escapeHtml(question.question);
}

function renderModelAnswerBlock(question) {
  if (question.questionType === 'multi-part') return '';
  return `<div class="bg-green-50/50 border border-green-200 rounded-2xl p-5 mt-6 flex flex-col gap-3">
    <span class="inline-flex self-start items-center gap-1 text-xs font-black text-green-700 bg-green-100/80 px-2.5 py-1 rounded-full"><i data-lucide="check" class="w-4 h-4"></i><span>الجواب النموذجي:</span></span>
    ${renderAnswerContent(question)}
  </div>`;
}

function renderRating(question) {
  const current = appState.ratings[question.id];
  return `<div class="bg-white border border-borders rounded-3xl p-5 mt-6 flex flex-col gap-4">
    <div class="text-center"><h4 class="text-sm font-black text-main-text">قيّم محاولتك رقميًا</h4><p class="text-xs font-bold text-muted-text mt-1">اختر رقمًا من 1 إلى 10 بعد مقارنة محاولتك بالجواب النموذجي</p></div>
    <div class="grid grid-cols-5 gap-2 w-full max-w-md mx-auto">${Array.from({ length: 10 }, (_, index) => index + 1).map(value => `<button type="button" data-rating-id="${question.id}" data-rating-value="${value}" class="rating-btn py-3 text-sm font-black rounded-xl border transition-all ${current === value ? 'bg-primary-purple border-primary-purple text-white shadow-sm' : 'bg-white border-borders text-muted-text hover:border-primary-purple'}">${value}</button>`).join('')}</div>
  </div>`;
}

function renderHomeScreen() {
  const source = BIOLOGY_CHAPTER_01.sourceQuestions;
  const enrichment = BIOLOGY_CHAPTER_01.enrichmentQuestions;
  const sourceAttempted = source.filter(isQuestionAttempted).length;
  const enrichmentAttempted = enrichment.filter(isQuestionAttempted).length;
  const sourcePercent = Math.round((sourceAttempted / source.length) * 100) || 0;
  const enrichmentPercent = Math.round((enrichmentAttempted / enrichment.length) * 100) || 0;

  queueMicrotask(() => {
    document.getElementById('open-source-btn')?.addEventListener('click', safeAction(() => { activeSection = 'source'; activeIdx = 0; currentFilter = 'all'; currentScreen = 'question'; renderApp(); }));
    document.getElementById('open-enrichment-btn')?.addEventListener('click', safeAction(() => { activeSection = 'enrichment'; activeIdx = 0; currentFilter = 'all'; currentScreen = 'question'; renderApp(); }));
    document.getElementById('home-reset-btn')?.addEventListener('click', safeAction(() => { showResetConfirm = true; renderApp(); }));
  });

  const pathCard = (id, icon, title, count, attempted, percent, label) => `<div class="bg-white border border-borders p-6 rounded-3xl shadow-sm flex flex-col justify-between gap-5 hover:border-primary-purple/40 transition-all">
    <div class="flex flex-col gap-3"><div class="w-12 h-12 rounded-2xl bg-soft-lavender flex items-center justify-center text-primary-purple"><i data-lucide="${icon}" class="w-6 h-6"></i></div><h3 class="text-lg font-black text-main-text">${title}</h3><p class="text-xs font-bold leading-relaxed text-muted-text">تضم هذه المجموعة ${count} سؤالًا مع حفظ محاولات الطالب محليًا على الجهاز.</p></div>
    <div class="flex flex-col gap-3"><div class="flex justify-between items-center text-xs font-black"><span class="text-muted-text">إنجاز المحاولات</span><span class="text-primary-purple">${attempted} من ${count} (${percent}%)</span></div><div class="w-full bg-page-bg rounded-full h-2.5 overflow-hidden"><div class="bg-primary-purple h-full rounded-full" style="width:${percent}%"></div></div><button id="${id}" class="w-full py-3 px-4 bg-primary-purple hover:bg-accent-purple text-white font-extrabold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5"><span>${label}</span><i data-lucide="arrow-left" class="w-4.5 h-4.5"></i></button></div>
  </div>`;

  return `<div class="flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
    <div class="bg-gradient-to-br from-primary-purple to-dark-purple text-white p-6 md:p-8 rounded-3xl shadow-md border border-borders/20 relative overflow-hidden"><div class="relative z-10 flex flex-col gap-3"><div class="inline-flex self-start bg-white/15 text-white border border-white/20 rounded-full px-3 py-1 text-xs font-black">${escapeHtml(BIOLOGY_CHAPTER_01.meta.subject)}</div><h1 class="text-2xl md:text-3xl font-black leading-snug">${escapeHtml(BIOLOGY_CHAPTER_01.meta.chapterTitle)}</h1></div></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">${pathCard('open-source-btn','book-open','الأسئلة المنهجية',source.length,sourceAttempted,sourcePercent,'افتح الأسئلة المنهجية')}${pathCard('open-enrichment-btn','sparkles','الأسئلة الإثرائية',enrichment.length,enrichmentAttempted,enrichmentPercent,'افتح الأسئلة الإثرائية')}</div>
    <div class="flex justify-end"><button id="home-reset-btn" class="text-xs font-black text-red-600 hover:bg-red-50 py-2.5 px-4 rounded-xl border border-red-200 flex items-center gap-1"><i data-lucide="rotate-ccw" class="w-4 h-4"></i><span>إعادة تعيين بيانات الفصل الأول</span></button></div>
  </div>`;
}

function renderQuestionScreen() {
  const filtered = getFilteredQuestions();
  if (activeIdx >= filtered.length) activeIdx = Math.max(0, filtered.length - 1);
  const question = filtered[activeIdx];
  const fullList = getSectionQuestions();

  const filterButtons = [
    ['all', 'الكل'],
    ['unanswered', 'غير مجاب'],
    ['unrated', 'غير مقيم'],
    ['rating_8_10', 'تقييم <bdi dir="ltr">8–10</bdi>'],
    ['rating_5_7', 'تقييم <bdi dir="ltr">5–7</bdi>'],
    ['rating_1_4', 'تقييم <bdi dir="ltr">1–4</bdi>']
  ];
  const tabs = `<div class="flex flex-col gap-4 border-b border-borders pb-4"><div class="flex gap-2 bg-white p-1 rounded-2xl border border-borders w-full max-w-md mx-auto"><button id="tab-source" class="flex-grow py-2.5 rounded-xl text-sm font-black ${activeSection === 'source' ? 'bg-primary-purple text-white shadow-sm' : 'text-muted-text'}">الأسئلة المنهجية</button><button id="tab-enrichment" class="flex-grow py-2.5 rounded-xl text-sm font-black ${activeSection === 'enrichment' ? 'bg-primary-purple text-white shadow-sm' : 'text-muted-text'}">الأسئلة الإثرائية</button></div><div class="flex flex-wrap gap-2 justify-center">${filterButtons.map(([value,label]) => `<button data-filter="${value}" class="filter-btn text-xs font-black py-1.5 px-3.5 rounded-full border ${currentFilter === value ? 'bg-primary-purple border-primary-purple text-white' : 'bg-white border-borders text-muted-text'}">${label}</button>`).join('')}</div></div>`;

  const pagination = `<div class="flex flex-col gap-2 mt-4"><div class="text-xs font-black text-muted-text flex justify-between"><span>قائمة الأسئلة (اضغط للقفز السريع):</span><span>السؤال ${question ? activeIdx + 1 : 0} من ${filtered.length}</span></div><div class="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar w-full flex-wrap justify-center">${fullList.map(item => {
    const index = filtered.findIndex(candidate => candidate.id === item.id);
    const current = index === activeIdx && index >= 0;
    const attempted = isQuestionAttempted(item);
    const rated = appState.ratings[item.id] !== undefined;
    const classes = current ? 'bg-primary-purple border-primary-purple text-white shadow-sm' : index < 0 ? 'bg-gray-100 border-gray-200 text-gray-300 opacity-40 pointer-events-none' : rated ? 'bg-green-50 border-green-200 text-green-700' : attempted ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-borders text-muted-text';
    return `<button data-jump-index="${index}" class="jump-btn w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold border ${classes}">${item.num}</button>`;
  }).join('')}</div></div>`;

  if (!question) {
    queueMicrotask(bindQuestionEvents);
    return `<div class="flex flex-col gap-4">${tabs}<div class="bg-white border border-borders rounded-3xl p-8 text-center"><p class="text-base font-black text-muted-text">لا توجد أسئلة تطابق الفلتر المختار.</p></div></div>`;
  }

  const shown = Boolean(appState.shownAnswers[question.id]);
  const canReveal = hasRevealableAnswer(question);
  const input = question.questionType === 'multi-part' ? renderMultiPartInput(question, shown) : question.questionType === 'drawing' ? renderDrawingInput(question) : renderStudentInput(question, shown);
  const questionTitle = question.questionType === 'fill' ? 'املأ الفراغات:' : renderQuestionTitle(question);
  const model = shown && canReveal ? (question.questionType === 'multi-part' ? '' : renderModelAnswerBlock(question)) : '';
  const rating = shown && canReveal ? renderRating(question) : '';

  queueMicrotask(bindQuestionEvents);

  return `<div class="flex flex-col gap-6 max-w-3xl mx-auto w-full">${tabs}${pagination}
    <div class="bg-white border border-borders rounded-3xl p-6 md:p-8 shadow-sm flex flex-col gap-5 mt-2">
      <div class="flex justify-between items-center flex-wrap gap-2"><span class="inline-flex items-center gap-1.5 text-xs font-black text-primary-purple bg-soft-lavender px-3 py-1.5 rounded-full"><i data-lucide="${activeSection === 'source' ? 'book-open' : 'sparkles'}" class="w-4 h-4"></i><span>${activeSection === 'source' ? 'سؤال مصدري' : 'سؤال إثرائي'}</span></span><span class="text-sm font-black text-muted-text">السؤال ${question.num}</span></div>
      <h2 class="question-text text-lg md:text-xl font-extrabold text-main-text leading-relaxed mt-2 whitespace-pre-wrap">${questionTitle}</h2>
      <div class="mt-2 border-t border-borders pt-4">${input}</div>
      ${canReveal && !shown ? `<div class="border-t border-borders pt-6 flex justify-center mt-2"><button id="reveal-btn" ${isQuestionAttempted(question) ? '' : 'disabled'} class="py-3 px-6 rounded-xl border border-primary-purple text-primary-purple font-extrabold text-sm flex items-center gap-1.5 ${isQuestionAttempted(question) ? 'hover:bg-primary-purple/10' : 'opacity-50 cursor-not-allowed'}"><i data-lucide="eye" class="w-5 h-5"></i><span>إظهار الجواب النموذجي</span></button></div>` : ''}
      ${model}${rating}
    </div>
    <div class="flex justify-between items-center"><button id="prev-btn" class="py-3 px-5 bg-white border border-borders text-muted-text rounded-xl text-sm font-black flex items-center gap-1.5 ${activeIdx <= 0 ? 'opacity-30 pointer-events-none' : ''}"><i data-lucide="arrow-right" class="w-5 h-5"></i><span>السؤال السابق</span></button><button id="next-btn" class="py-3 px-5 bg-white border border-borders text-muted-text rounded-xl text-sm font-black flex items-center gap-1.5 ${activeIdx >= filtered.length - 1 ? 'opacity-30 pointer-events-none' : ''}"><span>السؤال التالي</span><i data-lucide="arrow-left" class="w-5 h-5"></i></button></div>
  </div>`;
}

function renderDrawingInput(question) {
  const image = drawingImages[question.id];
  return `<div class="flex flex-col gap-4"><span class="text-xs font-black text-muted-text">أرفق صورة لمحاولتك بالرسم (PNG أو JPG أو WebP، حد أقصى 8 ميجابايت):</span><div class="flex items-center gap-3 flex-wrap"><label class="bg-white border border-borders hover:border-primary-purple font-bold text-xs py-2.5 px-4 rounded-xl shadow-sm cursor-pointer flex items-center gap-1.5"><i data-lucide="camera" class="w-4.5 h-4.5"></i><span>${image ? 'استبدال الصورة...' : 'اختر ملف صورة...'}</span><input type="file" data-drawing-input="${question.id}" class="hidden" accept="image/png,image/jpeg,image/webp"></label>${image ? `<button type="button" data-drawing-delete="${question.id}" class="bg-red-50 border border-red-200 text-red-600 font-extrabold text-xs py-2 px-3 rounded-xl flex items-center gap-1"><i data-lucide="trash-2" class="w-4 h-4"></i><span>إزالة الصورة</span></button>` : ''}</div><div data-file-error="${question.id}" class="text-xs font-black text-red-600 hidden"></div>${image ? `<div class="border border-borders rounded-xl overflow-hidden self-start max-w-sm max-h-[240px]"><img src="${image}" alt="محاولة الطالب" class="w-full h-auto object-contain max-h-[240px]"></div><div class="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs font-black text-indigo-800 flex items-center gap-2"><i data-lucide="info" class="w-4 h-4"></i><span>${DRAWING_NOTICE}</span></div>` : ''}</div>`;
}

function bindQuestionEvents() {
  document.getElementById('tab-source')?.addEventListener('click', safeAction(() => { activeSection = 'source'; activeIdx = 0; currentFilter = 'all'; renderApp(); }));
  document.getElementById('tab-enrichment')?.addEventListener('click', safeAction(() => { activeSection = 'enrichment'; activeIdx = 0; currentFilter = 'all'; renderApp(); }));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', safeAction(event => { currentFilter = event.currentTarget.dataset.filter; activeIdx = 0; renderApp(); })));
  document.querySelectorAll('[data-jump-index]').forEach(button => button.addEventListener('click', safeAction(event => { const index = Number(event.currentTarget.dataset.jumpIndex); if (index >= 0) { activeIdx = index; renderApp(); } })));

  document.querySelectorAll('[data-written-id]').forEach(input => input.addEventListener('input', event => { appState.answers[event.currentTarget.dataset.writtenId] = event.currentTarget.value; saveAppState(); updateRevealButton(); }));
  document.querySelectorAll('[data-fill-id]').forEach(input => input.addEventListener('input', event => { const id = event.currentTarget.dataset.fillId; const index = Number(event.currentTarget.dataset.fillIndex); const values = appState.fillAnswers[id] || []; values[index] = event.currentTarget.value; appState.fillAnswers[id] = values; saveAppState(); updateRevealButton(); }));
  document.querySelectorAll('[data-mcq-id]').forEach(button => button.addEventListener('click', safeAction(event => { appState.mcqAnswers[event.currentTarget.dataset.mcqId] = Number(event.currentTarget.dataset.mcqIndex); saveAppState(); renderApp(); })));
  document.querySelectorAll('[data-tf-id]').forEach(button => button.addEventListener('click', safeAction(event => { const id = event.currentTarget.dataset.tfId; const current = appState.tfAnswers[id] || { correction: '' }; appState.tfAnswers[id] = { selected: event.currentTarget.dataset.tfValue === 'true', correction: current.correction || '' }; saveAppState(); renderApp(); })));
  document.querySelectorAll('[data-correction-id]').forEach(input => input.addEventListener('input', event => { const id = event.currentTarget.dataset.correctionId; const current = appState.tfAnswers[id] || { selected: false, correction: '' }; current.correction = event.currentTarget.value; appState.tfAnswers[id] = current; saveAppState(); updateRevealButton(); }));
  document.querySelectorAll('[data-rating-id]').forEach(button => button.addEventListener('click', safeAction(event => { appState.ratings[event.currentTarget.dataset.ratingId] = Number(event.currentTarget.dataset.ratingValue); saveAppState(); renderApp(); })));

  document.querySelectorAll('[data-drawing-input]').forEach(input => input.addEventListener('change', event => handleDrawingFile(event.currentTarget)));
  document.querySelectorAll('[data-drawing-delete]').forEach(button => button.addEventListener('click', safeAction(async event => { const id = event.currentTarget.dataset.drawingDelete; await deleteDrawingImage(id); delete drawingImages[id]; renderApp(); })));

  document.getElementById('reveal-btn')?.addEventListener('click', safeAction(() => { const question = getFilteredQuestions()[activeIdx]; if (question && isQuestionAttempted(question)) { appState.shownAnswers[question.id] = true; saveAppState(); renderApp(); } }));
  document.getElementById('prev-btn')?.addEventListener('click', safeAction(() => { if (activeIdx > 0) { activeIdx -= 1; renderApp(); } }));
  document.getElementById('next-btn')?.addEventListener('click', safeAction(() => { if (activeIdx < getFilteredQuestions().length - 1) { activeIdx += 1; renderApp(); } }));
}

function updateRevealButton() {
  const button = document.getElementById('reveal-btn');
  const question = getFilteredQuestions()[activeIdx];
  if (!button || !question) return;
  const valid = isQuestionAttempted(question);
  button.disabled = !valid;
  button.classList.toggle('opacity-50', !valid);
  button.classList.toggle('cursor-not-allowed', !valid);
}

async function handleDrawingFile(input) {
  const id = input.dataset.drawingInput;
  const file = input.files?.[0];
  if (!file) return;
  const error = document.querySelector(`[data-file-error="${id}"]`);
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(file.type) || file.size > 8 * 1024 * 1024) {
    if (error) { error.textContent = allowed.includes(file.type) ? 'حجم الصورة يجب أن يكون أقل من 8 ميجابايت.' : 'اختر صورة بصيغة PNG أو JPG أو WebP.'; error.classList.remove('hidden'); }
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => { await saveDrawingImage(id, reader.result); drawingImages[id] = reader.result; renderApp(); };
  reader.readAsDataURL(file);
}

function renderResultsScreen() {
  const questions = allMainQuestions();
  const attempted = questions.filter(isQuestionAttempted).length;
  const ratings = Object.values(appState.ratings).filter(value => Number.isInteger(value) && value >= 1 && value <= 10);
  const average = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2) : '0.00';
  queueMicrotask(() => document.getElementById('results-reset-btn')?.addEventListener('click', safeAction(() => { showResetConfirm = true; renderApp(); })));
  return `<div class="max-w-3xl mx-auto w-full flex flex-col gap-6"><div class="bg-white border border-borders rounded-3xl p-6 md:p-8 shadow-sm"><h2 class="text-2xl font-black text-main-text">النتائج والتقرير</h2><p class="text-sm font-bold text-muted-text mt-2">ملخص رقمي لمحاولات الفصل الأول دون تصنيفات نوعية.</p><div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">${[['الأسئلة الكلية',questions.length],['الأسئلة المجابة',attempted],['الأسئلة المقيمة',ratings.length],['متوسط التقييم',average]].map(([label,value]) => `<div class="rounded-2xl border border-borders bg-page-bg/40 p-4 text-center"><div class="text-2xl font-black text-primary-purple">${value}</div><div class="text-xs font-black text-muted-text mt-1">${label}</div></div>`).join('')}</div></div><div class="flex justify-end"><button id="results-reset-btn" class="text-xs font-black text-red-600 border border-red-200 rounded-xl px-4 py-2.5">إعادة تعيين بيانات الفصل الأول</button></div></div>`;
}

function renderApp() {
  const root = document.getElementById('app-container');
  if (!root) return;
  const content = currentScreen === 'home' ? renderHomeScreen() : currentScreen === 'results' ? renderResultsScreen() : renderQuestionScreen();
  const modal = showResetConfirm ? `<div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]" id="reset-confirm-modal"><div class="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full border border-borders shadow-2xl flex flex-col gap-5"><h3 class="text-lg font-black text-main-text">إعادة تعيين بيانات الفصل الأول؟</h3><p class="text-xs font-bold text-muted-text leading-relaxed">سيتم حذف محاولات هذا الفصل ورسوماته فقط، دون المساس ببيانات الفصول الأخرى.</p><div class="flex gap-3"><button id="modal-confirm-reset-btn" class="flex-1 py-3 bg-red-600 text-white font-extrabold text-sm rounded-xl">نعم، متأكد</button><button id="modal-cancel-reset-btn" class="flex-1 py-3 bg-white border border-borders text-muted-text font-extrabold text-sm rounded-xl">إلغاء</button></div></div></div>` : '';
  root.innerHTML = `<header class="bg-white border-b border-borders sticky top-0 z-50 py-3 px-4 md:px-8 shadow-sm"><div class="max-w-4xl mx-auto flex justify-between items-center"><span class="text-xl font-black text-primary-purple">تطبيق مدرسي</span><div class="flex items-center gap-2"><button id="nav-home" class="text-sm font-extrabold text-muted-text hover:text-primary-purple flex items-center gap-1.5 py-1.5 px-3 rounded-xl ${currentScreen === 'home' ? 'bg-soft-lavender text-primary-purple' : ''}"><i data-lucide="home" class="w-4.5 h-4.5"></i><span>الرئيسية</span></button><button id="nav-results" class="text-sm font-extrabold text-muted-text hover:text-primary-purple flex items-center gap-1.5 py-1.5 px-3 rounded-xl ${currentScreen === 'results' ? 'bg-soft-lavender text-primary-purple' : ''}"><i data-lucide="award" class="w-4.5 h-4.5"></i><span>النتائج والتقرير</span></button></div></div></header><main class="flex-grow w-full max-w-4xl mx-auto px-4 py-6 md:py-8">${content}</main>${modal}`;
  document.getElementById('nav-home')?.addEventListener('click', safeAction(() => { currentScreen = 'home'; renderApp(); }));
  document.getElementById('nav-results')?.addEventListener('click', safeAction(() => { currentScreen = 'results'; renderApp(); }));
  document.getElementById('modal-cancel-reset-btn')?.addEventListener('click', safeAction(() => { showResetConfirm = false; renderApp(); }));
  document.getElementById('modal-confirm-reset-btn')?.addEventListener('click', safeAction(async () => { localStorage.removeItem(STORAGE_KEY); appState = EMPTY_STATE(); await clearChapterDrawings(); drawingImages = {}; showResetConfirm = false; currentScreen = 'home'; renderApp(); }));
  createIcons({ icons: LOCAL_LUCIDE_ICONS });
}

window.addEventListener('DOMContentLoaded', async () => {
  loadAppState();
  await loadAllDrawings();
  renderApp();
});
