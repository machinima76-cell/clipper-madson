# 🐍 Madson Cobra Clipper

Crie clipes a partir de uma transmissão pública autorizada no YouTube, Twitch ou Kick, de uma gravação local ou de uma demonstração sintética. O painel acompanha cada análise via WebSocket. **A publicação nas plataformas é simulada**; baixe os arquivos para publicar manualmente.

## Executar

Com Docker e o plugin Compose, na raiz do repositório:

```sh
docker compose up --build
```

Abra **http://localhost:3000**. A imagem inclui as ferramentas de mídia. O Compose usa volumes nomeados para `media/` e `data/`; não use `docker compose down -v` se quiser preservá-los. A lista de análises fica em memória e é perdida ao reiniciar.

Sem Docker, instale Node.js 22, FFmpeg (com `ffprobe`), Python 3 e `yt-dlp`. Deixe os executáveis no `PATH` e rode:

```sh
npm ci
npm start
```

| Variável | Padrão | Uso |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Endereço e porta do servidor |
| `CAPACITY` | `3` | Número de análises simultâneas |
| `CLIP_SECONDS` | `30` | Duração de cada clipe em segundos (inteiro positivo). Se a gravação for mais curta, o corte usa apenas a duração disponível. |
| `YTDLP_BIN` | detecção automática | Executável usado para consultar e capturar lives |
| `FFMPEG_BIN` / `FFPROBE_BIN` | `ffmpeg` / `ffprobe` | Executáveis de processamento |

## Conferir o funcionamento

- Acesse `/api/health`: `ok` indica que o servidor responde e `ytdlp` indica se encontrou o executável de captura.
- Clique em **Ver demonstração**. O Python sintetiza áudio e vídeo com momentos predefinidos; o painel acompanha o processamento e oferece os clipes para download individual ou em ZIP.
- Para uma live real, informe o link de um canal ao vivo. A captura depende do acesso à plataforma. Depois que a captura termina, o FFmpeg analisa variações de cena e energia de áudio; não é um serviço externo de IA nem transcrição de fala. Se a captura não estiver disponível, envie uma gravação autorizada.

## Estrutura

- `server.js`: HTTP, WebSocket, upload e download em ZIP.
- `src/`: fila, captura, análise, renderização e publicação simulada. Os adaptadores das três plataformas ficam em `src/adapters/`.
- `public/`: painel web; `tools/make_demo_stream.py`: gerador de demonstrações.
- `media/` e `data/`: gerados em execução, não versionados.

## Hospedagem

Os manifestos `fly.toml` e `render.yaml` usam o `Dockerfile`. No Fly.io, ajuste o nome da aplicação e crie o volume `media` na região configurada antes do deploy. No Render, o manifesto gratuito usa disco efêmero: faça download dos clipes antes de reiniciar ou reimplantar o serviço. Para uso contínuo, dimensione CPU, disco e memória para a duração das capturas.

O painel não tem autenticação: mantenha-o em ambiente privado ou proteja o acesso antes de expô-lo à internet. Capture e publique apenas conteúdo autorizado.
