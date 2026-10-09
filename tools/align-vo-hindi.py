#!/usr/bin/env python3
"""align-vo-hindi.py — where each Hindi word falls in its recording.

    python3 tools/align-vo-hindi.py <request.json> <result.json>

Run by tools/build-vo-hindi.js --align, which writes the request (each recording and the Hindi
words the game shows for its line) and keeps the result in docs/vo-hindi.json, so the build
itself never needs this. Needs torch and torchaudio (2.1 to 2.8: torchaudio.functional.forced_align):

    python3 -m venv .venv && .venv/bin/pip install torch==2.5.1 torchaudio==2.5.1 soundfile
    PYTHON=.venv/bin/python node tools/build-vo-hindi.js --align

HOW. Meta's MMS forced aligner (torchaudio.pipelines.MMS_FA, trained on 1100+ languages) reads
romanized text, so each word is spelled out in Latin letters first (roman() below: a plain
Devanagari transliteration — the aligner is forgiving of spelling, it only needs the sounds in
order). A word with no sound (an em dash) gets null, and the builder gives it the next word's time.

  request: [{"file": "...opus",  (any format torchaudio reads: the recordings are Ogg Opus) "words": ["नमस्ते!", "मैं", ...]}]
  result:  {"<file>": {"dur": s, "words": [[start, end] | null, ...], "roman": [...]}}
"""
import json, sys, re
import torch, torchaudio

V = {'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e'}
M = {'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e'}
C = {'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
     'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
     'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
     'ष': 'sh', 'स': 's', 'ह': 'h',
     # (the nukta letters written as one character)
     'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y'}
NUKTA = {'ज': 'z', 'फ': 'f', 'ड': 'r', 'ढ': 'rh', 'क': 'q', 'ख': 'kh', 'ग': 'g'}
DIGITS = {'0': 'shunya', '1': 'ek', '2': 'do', '3': 'tin', '4': 'char', '5': 'panch', '6': 'chhah', '7': 'sat', '8': 'ath', '9': 'nau'}


def roman(word):
    # (the danda and double danda are full stops, though they sit in the Devanagari block)
    w = re.sub(r'[^ऀ-ॿ0-9A-Za-z]|[।॥]', '', word)
    if not w:
        return ''
    if re.fullmatch(r'[0-9]+', w):
        return ''.join(DIGITS[d] for d in w)
    if re.fullmatch(r'[A-Za-z]+', w):
        return w.lower()
    out, i, n = [], 0, len(w)
    while i < n:
        ch = w[i]
        if ch in C:
            cons = C[ch]
            if i + 1 < n and w[i + 1] == '़':
                cons = NUKTA.get(ch, cons)
                i += 1
            out.append(cons)
            nxt = w[i + 1] if i + 1 < n else ''
            if nxt in M:
                out.append(M[nxt]); i += 2; continue
            if nxt == '्':
                i += 2; continue
            # inherent vowel, dropped at the end of a word (schwa deletion)
            if i + 1 < n:
                out.append('a')
            i += 1
            continue
        if ch in V:
            out.append(V[ch])
        elif ch in ('ं', 'ँ'):
            out.append('n')
        elif ch == 'ः':
            out.append('h')
        i += 1
    return ''.join(out)


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    items = json.load(open(inp, encoding='utf8'))
    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=False)
    tok = bundle.get_tokenizer()
    aligner = bundle.get_aligner()
    res = {}
    for it in items:
        wav, sr = torchaudio.load(it['file'])
        if wav.size(0) > 1:
            wav = wav.mean(0, keepdim=True)
        if sr != bundle.sample_rate:
            wav = torchaudio.functional.resample(wav, sr, bundle.sample_rate)
        rom = [roman(w) for w in it['words']]
        spoken = [(k, r) for k, r in enumerate(rom) if r]
        with torch.inference_mode():
            em, _ = model(wav)
        spans = aligner(em[0], tok([r for _, r in spoken]))
        ratio = wav.size(1) / em.size(1) / bundle.sample_rate
        words = [None] * len(rom)
        for (k, _), sp in zip(spoken, spans):
            words[k] = [round(sp[0].start * ratio, 3), round(sp[-1].end * ratio, 3)]
        res[it['file']] = {'dur': round(wav.size(1) / bundle.sample_rate, 3), 'words': words, 'roman': rom}
        print(it['file'].split('/')[-1], ' '.join(f'{r}@{w[0] if w else "-"}' for r, w in zip(rom, words)), flush=True)
    json.dump(res, open(outp, 'w', encoding='utf8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
