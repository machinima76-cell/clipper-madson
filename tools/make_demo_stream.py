#!/usr/bin/env python3
"""Gera uma transmissao simulada (video + audio) para demonstracao do Clipper.

A midia gerada e processada de verdade pelo pipeline (analise de cenas,
picos de audio, cortes, miniaturas e legendas). Os momentos "plantados"
ficam no sidecar JSON e simulam o que a IA detectaria semanticamente.
"""
import argparse
import array
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
import wave

RATE = 44100
TABLE = 2048
W, H = 854, 480

LABELS = [
    'Reação épica', 'Jogada insana', 'Clutch', 'Fail hilário',
    'Quadrinho do chat', 'Estratégia genial', 'Momento emocionante', 'Reviravolta',
]

COLORS = ['0x1f6feb', '0x8957e5', '0x2ea043', '0xd29922', '0xda3633', '0x1a7f37', '0x2180f0']


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True)
    p.add_argument('--duration', type=float, default=180.0)
    p.add_argument('--sidecar', required=True)
    p.add_argument('--seed', type=int, default=None)
    return p.parse_args()


def build_segments(duration, rng):
    segs = []
    t = 0.0
    while t < duration - 1:
        remaining = duration - t
        if remaining <= 30:
            L = remaining
        else:
            L = min(rng.uniform(18, 30), remaining)
        segs.append((t, L))
        t += L
        if len(segs) >= 14:
            break
    # garante ultimo segmento
    if not segs or segs[-1][0] + segs[-1][1] < duration - 0.5:
        s, L = segs[-1] if segs else (0.0, 0.0)
        segs.append((s + L, duration - (s + L)))
    return segs


def synth_audio(path, duration, segments, highlights, rng):
    n = int(duration * RATE)
    samples = array.array('h', [0]) * n

    def tone_cycle(freq, amp, tile=TABLE):
        return array.array('h', [int(amp * 32767 * math.sin(2 * math.pi * freq * i / RATE)) for i in range(tile)])

    def place(i0, i1, cycle):
        L = max(0, i1 - i0)
        if L <= 0:
            return
        tile = cycle * (L // len(cycle) + 1)
        samples[i0:i1] = tile[:L]

    # trilha de base por segmento (tom diferente para cada bloco)
    for (s_start, s_len) in segments:
        freq = 150 + rng.uniform(0, 90)
        amp = 0.05 + rng.uniform(0, 0.03)
        cycle = tone_cycle(freq, amp)
        place(int(s_start * RATE), min(n, int((s_start + s_len) * RATE)), cycle)

    # explosoes de "hype" nos destaques (picos de audio)
    for h in highlights:
        freq = 480 + rng.uniform(0, 180)
        cycle = tone_cycle(freq, 0.45)
        place(int(h['t'] * RATE), min(n, int((h['t'] + 1.4) * RATE)), cycle)

    # fade in/out simples
    fade = int(0.25 * RATE)
    for i in range(min(fade, n)):
        samples[i] = int(samples[i] * (i / fade))
        samples[n - 1 - i] = int(samples[n - 1 - i] * (i / fade))

    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())


def make_video_segments(tmp, segments, rng):
    files = []
    for i, (s, L) in enumerate(segments):
        out = os.path.join(tmp, f'seg{i:02d}.mp4')
        kind = i % 3
        if kind == 0:
            src = f'testsrc2=size={W}x{H}:rate=30:duration={L:.2f}'
            vf = None
        elif kind == 1:
            c0 = rng.choice(COLORS)
            c1 = rng.choice(['0x0d1117', '0x57534e', '0x116329', '0x9e6a03', '0x8250df', '0xbf4b4b'])
            x0 = rng.randint(0, W - 1)
            y0 = rng.randint(0, H - 1)
            src = (f'gradients=size={W}x{H}:rate=30:duration={L:.2f}:speed=0.03:'
                   f'x0={x0}:y0={y0}:c0={c0}:c1={c1}:nb_colors=4:seed={rng.randint(0, 9999)}')
            vf = None
        else:
            src = f'testsrc2=size={W}x{H}:rate=30:duration={L:.2f}'
            vf = f'hue=h={rng.uniform(-60, 60):.1f}:s={rng.uniform(0.6, 1.6):.2f}'
        cmd = [os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-y', '-f', 'lavfi', '-i', src, '-t', f'{L:.2f}']
        if vf:
            cmd += ['-vf', vf]
        cmd += ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', out]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            # fallback: testsrc2 simples
            fb = [os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-y', '-f', 'lavfi', '-i', f'testsrc2=size={W}x{H}:rate=30:duration={L:.2f}',
                  '-t', f'{L:.2f}', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26',
                  '-pix_fmt', 'yuv420p', '-an', out]
            subprocess.run(fb, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        files.append(out)
    return files


def main():
    args = parse_args()
    rng = random.Random(args.seed)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='madson_demo_')

    try:
        run(args, rng, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run(args, rng, tmp):
    segments = build_segments(args.duration, rng)

    # destaques plantados (1 por segmento; 2 nos longos)
    highlights = []
    for idx, (s, L) in enumerate(segments):
        n_h = 2 if L > 24 else 1
        used = []
        for k in range(n_h):
            for _ in range(20):
                t = s + rng.uniform(4, max(5.0, L - 5))
                if all(abs(t - u) > 8 for u in used):
                    used.append(t)
                    break
            if not used or (k == 1 and len(used) < 2):
                continue
            t = used[-1]
            highlights.append({
                't': round(t, 2),
                'label': LABELS[(idx * 3 + k) % len(LABELS)],
                'score': int(rng.randint(78, 97)),
                'reason': 'Pico de áudio + corte de cena detectado pela IA',
            })
    highlights.sort(key=lambda h: h['t'])

    wav_path = os.path.join(tmp, 'audio_full.wav')
    print(f'[demo] sintetizando audio ({args.duration:.0f}s)...', flush=True)
    synth_audio(wav_path, args.duration, segments, highlights, rng)

    print('[demo] renderizando segmentos de video...', flush=True)
    vfiles = make_video_segments(tmp, segments, rng)

    listfile = os.path.join(tmp, 'vlist.txt')
    with open(listfile, 'w') as f:
        for fp in vfiles:
            f.write(f"file '{fp}'\n")

    print('[demo] muxando video + audio...', flush=True)
    cmd = [os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-y', '-f', 'concat', '-safe', '0', '-i', listfile,
           '-i', wav_path, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
           '-shortest', '-movflags', '+faststart', args.out]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # limpa segmentos temporarios
    for fp in vfiles + [wav_path, listfile]:
        try:
            os.remove(fp)
        except OSError:
            pass

    with open(args.sidecar, 'w') as f:
        json.dump({
            'duration': args.duration,
            'segments': [{'start': round(s, 2), 'len': round(L, 2)} for s, L in segments],
            'highlights': highlights,
        }, f, ensure_ascii=False, indent=1)

    print(f'[demo] pronto: {args.out} ({len(highlights)} momentos plantados)', flush=True)


if __name__ == '__main__':
    main()
