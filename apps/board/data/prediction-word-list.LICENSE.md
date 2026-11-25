# Prediction word list: licence notice

File: `prediction-word-list.json`

Licence: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0),
<https://creativecommons.org/licenses/by-sa/4.0/>.

## Source

- Repository: <https://github.com/hermitdave/FrequencyWords>
- File: `content/2018/en/en_50k.txt` (English, 50,000 most frequent words)
- Author: Hermit Dave
- Underlying data: English subtitles from the OpenSubtitles 2018 corpus, distributed
  through OPUS (<https://opus.nlpl.eu/OpenSubtitles2018.php>).
- The repository README states: "MIT License for code. CC-by-sa-4.0 for content."
  This file is derived from the content, so CC BY-SA 4.0 applies.

## Changes made

The source file was changed as follows:

1. Trimmed: only the first 5,000 entries that pass the filters are kept.
2. Lower-cased: every word.
3. Filtered: only entries made of the letters a-z and apostrophes, of length 2 or more,
   are kept; every word that is in the Board's core vocabulary is removed.
4. Re-ranked: the raw occurrence counts are replaced by `1 / (rank + 1)`, where rank is
   the 0-based position in the kept list (source order).

## Sharing

This file is an adaptation of the source data and is shared under CC BY-SA 4.0. The
Board's own code is MIT licensed; the share-alike condition applies to this data file
only.
