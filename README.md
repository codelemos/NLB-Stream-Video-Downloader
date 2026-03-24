# NLB Stream Video Downloader

Uma extensão para Chrome que permite baixar vídeos de sites de streaming (HLS/m3u8, MP4), incluindo Vimeo com áudio e vídeo automaticamente combinados.

## ✨ Funcionalidades

- **Detecção automática** de vídeos em páginas (HLS/m3u8 e MP4)
- **Download de streams HLS** com todos os segmentos combinados
- **Muxing automático** de áudio e vídeo usando FFmpeg.wasm
- **Suporte a Vimeo** - combina automaticamente streams separados de áudio/vídeo
- **Nome inteligente** - salva arquivos com o título da página
- **Progresso visual** - barra de progresso durante download

## 📦 Instalação

1. Clone ou baixe este repositório
2. Abra `chrome://extensions/` no Chrome
3. Ative o **Modo do desenvolvedor**
4. Clique em **Carregar sem compactação**
5. Selecione a pasta do projeto

## 🎯 Como Usar

1. Acesse um site com vídeo (ex: Vimeo)
2. Clique no ícone da extensão
3. Vídeos detectados aparecerão na lista
4. Clique em **Processar** para baixar

## 🛠️ Estrutura do Projeto

```
ext-video-downloader/
├── manifest.json       # Configuração da extensão
├── background.js       # Service Worker principal
├── downloader.js       # Lógica de download HLS
├── content.js          # Script injetado nas páginas
├── popup.html/js/css   # Interface do usuário
├── offscreen.html/js   # Processamento FFmpeg.wasm
└── ffmpeg-core/        # Arquivos FFmpeg.wasm bundlados
```

## 🔧 Tecnologias

- **Manifest V3** - API moderna de extensões Chrome
- **FFmpeg.wasm** - Muxing de áudio/vídeo no browser
- **HLS Parser** - Download de streams m3u8
- **Offscreen Documents** - Processamento WebAssembly

## 📝 Notas

- A extensão tem ~32MB devido ao FFmpeg.wasm bundlado
- Primeira execução pode demorar mais (carregamento do WASM)
- Se o mux falhar, arquivos separados são salvos com instruções

## 📄 Licença

MIT
