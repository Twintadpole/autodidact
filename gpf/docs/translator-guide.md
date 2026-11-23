# Great Pool Friend: translation review

The app speaks English, Español, Tiếng Việt, 中文（简体）, Tagalog and العربية. The translations other than English were made by Claude and are marked **beta** until a native speaker has checked them. This is how a review works.

## For the reviewer

You get one Excel file for your language, for example `es-review.xlsx`.

1. Open the **Texts** tab. Each row is one text the app shows: the **English**, the **Translation now**, and **Where** it appears.
2. If the translation is wrong, unclear or sounds unnatural, write a better one in **Your correction** (the yellow column). Leave it empty when it is fine.
3. Keep everything in `{curly braces}` exactly as it is, such as `{name}`, `{n}` or `{date}`. The app puts a name, a number or a date there. You may move it within the sentence.
4. Rows marked "form: one", "form: few" and so on are the same sentence for different numbers.
5. Write questions or notes in **Comment**.
6. Readers are pool technicians and owners in the US, on a phone, often outdoors. Short, plain, everyday words are best.
7. Keep "Great Pool Friend" and the water-test short names (FC, pH, CYA, TA, CH) as they are.
8. Save the file as .xlsx and send it back.

## For the owner

1. Ask Claude for the review sheets (or run `npm run i18n:review -- export es vi zh tl ar --out <folder>` in `pool-service/`).
2. Send each reviewer their language's file, with this guide.
3. When a file comes back, give it to Claude. Claude runs `npm run i18n:review -- import <code> <file> --dry-run`, shows you what changes, then imports it. Corrections that drop a `{placeholder}` are refused and listed, and the reviewer's comments are listed so they can be answered.
4. After a full review, that language loses its "beta" mark.

## Support

{{SUPPORT}}
