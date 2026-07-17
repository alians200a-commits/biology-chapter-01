# تطبيق مدرسي — الأحياء — الفصل الأول

تطبيق تفاعلي للفصل الأول: **الخلية**.

## المحتوى المعتمد

- سجلّات المصدر مستخرجة من `source-private/BIOLOGY_CH01_CONTENT_MASTER.txt`.

## التشغيل محليًا

```bash
npm ci
npm run dev
```

يظهر رابط محلي، ويعمل افتراضيًا على المنفذ `3000`.

## الفحص والبناء

```bash
npm run lint
npm run build
node scripts/verify-biology-chapter-01.mjs --mode=postbuild
```

## حماية المصدر

ملفا PDF وTXT الأصليان مخصصان للفحص المحلي الخاص فقط داخل `source-private/`، وهما مستبعدان من المستودع العام.

## GitHub Pages

يوجد مسار نشر جاهز في:

```text
.github/workflows/deploy-pages.yml
```

عند الدفع إلى فرع `main` أو `master`، يُجرى الفحص والبناء ثم النشر تلقائيًا.
