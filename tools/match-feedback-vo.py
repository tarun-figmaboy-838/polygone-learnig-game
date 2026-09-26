#!/usr/bin/env python3
"""Match generated feedback clips to the recorded lesson voice.

Set OPENVOICE_REPO to a checkout of myshell-ai/OpenVoice and OPENVOICE_MODEL
to its OpenVoiceV2 converter checkpoint directory. The input clips are the
original generated MP3s in assets/source/feedback-tts-original. This writes
converted MP3/Vorbis clips to --out without modifying the game's audio.

The conversion uses the recorded p04 and p24 clips as the target voice. The
approved Great job! comparison used the same references and tau=1.0.
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VO = ROOT / "assets" / "vo"
SOURCE = ROOT / "assets" / "source" / "feedback-tts-original"
REFERENCES = ("p04", "p24")
SKIP = {"fb18"}  # Yay! was cut directly from the recorded performance.


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def duration(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", str(path)],
        check=True, capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def loudness(path):
    """Integrated loudness (LUFS) and sample peak (dBFS) of a clip."""
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af", "ebur128=peak=sample", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    summary = result.stderr[result.stderr.rfind("Summary"):]
    lufs = re.search(r"I:\s+(-?[\d.]+) LUFS", summary)
    peak = re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary)
    if not lufs or not peak:
        raise RuntimeError(f"Could not measure the level of {path}")
    return float(lufs.group(1)), float(peak.group(1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    repo = Path(os.environ["OPENVOICE_REPO"])
    model = Path(os.environ["OPENVOICE_MODEL"])
    sys.path.insert(0, str(repo))
    from openvoice.api import OpenVoiceBaseClass, ToneColorConverter

    # Avoid the optional watermark loader. Some OpenVoice versions forward its
    # enable_watermark argument to a base class that does not accept it.
    converter = ToneColorConverter.__new__(ToneColorConverter)
    OpenVoiceBaseClass.__init__(converter, str(model / "config.json"), device="cpu")
    converter.watermark_model = None
    converter.version = getattr(converter.hps, "_version_", "v1")
    converter.load_ckpt(str(model / "checkpoint.pth"))
    target = converter.extract_se([str(VO / f"{id}.mp3") for id in REFERENCES])

    args.out.mkdir(parents=True, exist_ok=True)
    clips = sorted(p for p in SOURCE.glob("fb*.mp3") if p.stem not in SKIP)
    if len(clips) != 25:
        raise RuntimeError(f"Expected 25 original feedback clips in {SOURCE}; found {len(clips)}")
    for src in clips:
        source = converter.extract_se(str(src))
        wav = args.out / f"{src.stem}.wav"
        converter.convert(str(src), source, target, output_path=str(wav), tau=1.0)
        if abs(duration(src) - duration(wav)) > 0.12:
            raise RuntimeError(f"Unexpected duration change for {src.name}")
        # A plain gain to the lesson's level (-20.5 LUFS, the peak kept under
        # -1.5 dBFS), at 44.1 kHz like every other clip. Not loudnorm: in one
        # pass it rides the level of a clip this short (up to 3 dB hot), and
        # it resamples to 192 kHz unless told otherwise.
        lufs, peak = loudness(wav)
        filt = f"aresample=44100,volume={min(-20.5 - lufs, -1.5 - peak):.2f}dB"
        run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
            "-af", filt, "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k",
            str(args.out / src.name))
        run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
            "-af", filt, "-ar", "44100", "-ac", "1", "-c:a", "libvorbis", "-q:a", "1",
            str(args.out / f"{src.stem}.ogg"))
        wav.unlink()
        print(f"{src.stem}: {duration(src):.2f}s -> {duration(args.out / src.name):.2f}s", flush=True)
    print(f"Converted {len(clips)} feedback lines into {args.out}")


if __name__ == "__main__":
    main()
