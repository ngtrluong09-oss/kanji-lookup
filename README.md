# Kanji Lookup — stroke order, meanings, on/kun, Pinyin and Hán Việt

A small static website for looking up the **2,136 Jōyō kanji**. For each kanji it shows:

- **Stroke order**: stroke count, radical, components, a numbered stroke-order diagram with an animation, step-by-step frames, and the English name of each stroke type.
- **English meanings**.
- **Readings compared side by side**: on'yomi (katakana + romaji), kun'yomi (hiragana + romaji, okurigana greyed), Mandarin **Hanyu Pinyin** with tone marks, and Sino-Vietnamese **Hán Việt**.
- **Common words**: 3–5 example words from JMdict priority entries, with kana, romaji and English.

Search by kanji (paste one or several), English meaning, romaji (`gaku`), kana (`まなぶ`, `ガク`), pinyin (`xue`) or Hán Việt (`hoc`, accents optional).

Your **history** (auto-saved, grouped by day, up to 500 kanji), **favorites** (★) and **custom favorite groups** (create, rename, delete; a kanji can be in several groups) are stored in your browser's `localStorage` under the key `kanjiLookup.v1`. Use **Export JSON** / **Import JSON** to back them up or move them to another browser (import can replace or merge).

Plain HTML, CSS and vanilla JavaScript. No build step, no frameworks, no tracking. Light and dark themes, works on phones.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly from disk will not work, because the data files are loaded with `fetch`.)

## Publish on GitHub Pages

Push this folder to the root of a repository, then in **Settings → Pages** choose *Deploy from a branch*, branch `main`, folder `/ (root)`. The site will be at `https://<username>.github.io/<repo>/`. A deep link to a kanji looks like `…/#学`.

## Files

| Path | What |
|---|---|
| `index.html`, `style.css`, `app.js` | The app |
| `data/kanji.json` | 2,136 entries: meanings, readings, pinyin, Hán Việt, radical, components, grade, old JLPT level, frequency, example words |
| `data/strokes/<hex>.json` | KanjiVG stroke paths and stroke types, one file per kanji (file name = Unicode code point in 5-digit hex) |

## Data notes and gaps

- Coverage: all 2,136 Jōyō kanji (KANJIDIC2 grades 1–6 and 8). Order of the default list = KANJIDIC2 newspaper frequency.
- JLPT levels in KANJIDIC2 are the **old** 4-level system (shown as "JLPT old 4 (≈N5)" etc.).
- Hán Việt: present for all 2,136. For 剝 and 𠮟 (missing in KANJIDIC2) the readings were taken from the KANJIDIC2 entries of their standard variants 剥 and 叱; the page says so.
- Pinyin: missing for 6 kokuji (Japanese-made characters with no Chinese reading): 込 枠 栃 峠 塀 匂. 𠮟 uses the pinyin of 叱.
- Kun'yomi: 359 kanji have none (on'yomi only), which is normal.
- Examples: priority (common) JMdict words are used first; when fewer than 3 exist, less common JMdict words fill in and are tagged "less common". 4 kanji have fewer than 3 examples (雰 劾 摯 朕).
- Hán Việt for some kokuji (e.g. 込 liêu, 匂 cái) is as given in KANJIDIC2.
- Stroke counts: 9 kanji (葛 賭 謎 牙 餅 餌 僅 遡 遜) are drawn by KanjiVG in a glyph form whose stroke count differs by one from KANJIDIC2's Jōyō count; the page notes this under the diagram.
- Romaji is generated in the browser from the kana (Hepburn-style, long vowels written as typed, e.g. がっこう → gakkou).

## Credits and licences

- **KANJIDIC2** and **JMdict** — © Electronic Dictionary Research and Development Group (EDRDG), used under the [EDRDG licence](https://www.edrdg.org/edrdg/licence.html), Creative Commons Attribution-ShareAlike 4.0. <https://www.edrdg.org/wiki/index.php/KANJIDIC_Project>, <https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project>
- **KanjiVG** — © Ulrich Apel and contributors, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). <https://kanjivg.tagaini.net>
- Data files in `data/` are derived from the above (fields selected, pinyin converted to tone marks, Hán Việt lower-cased) and are shared under the same licences. See `LICENSE`.
