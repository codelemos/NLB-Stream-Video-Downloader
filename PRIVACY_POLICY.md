# Política de Privacidade - Stream Video Downloader

**Última atualização:** 24 de março de 2026

A sua privacidade é fundamental para nós. Esta Política de Privacidade descreve como a extensão "Stream Video Downloader" (doravante "Nós", "A Extensão" ou "O Serviço") coleta, utiliza e protege os seus dados ao ser instalada e utilizada no seu navegador.

Ao utilizar a nossa extensão, você concorda com a coleta e uso de informações de acordo com esta política.

## 1. Coleta e Uso de Dados

O "Stream Video Downloader" foi projetado para operar inteiramente localmente no seu dispositivo. **Nós não coletamos, não enviamos para nossos servidores, não armazenamos remotamente e não vendemos nenhum dado pessoal ou de navegação do usuário.**

Para executar a sua função principal de detectar e efetuar o download de vídeos (como HLS, m3u8, e MP4), a extensão requer acesso a certas informações da sua navegação e permissões, utilizadas estritamente e exclusivamente da seguinte forma:

*   **Inspeção de Rede (Permissões `webRequest`, `declarativeNetRequest`):** A extensão monitora localmente as requisições de rede feitas pelo seu navegador para identificar streams de vídeo em background. Ela pode ler cabeçalhos HTTP temporariamente (como `Referer`, `Origin`, `Cookies` e `Authorization`) apenas para conseguir replicar o acesso legítimo necessário e efetuar o download diretamente do servidor original do vídeo (evitando bloqueios de hotlinking). Nenhuma dessas informações de tráfego, URLs, cookies ou tokens é enviada para nós ou para terceiros.
*   **Dados da Aba Atual e Interação (Permissões `activeTab`, `scripting`):** A extensão acessa as informações básicas da aba atual (como o título da página) apenas no momento exato em que há a detecção e o download do arquivo. Essa informação é usada puramente para sugerir um nome de arquivo inteligente a ser salvo no seu computador.
*   **Armazenamento Temporário (Permissão `storage`):** Utilizamos o banco de dados interno e seguro nativo do seu navegador (`IndexedDB`) apenas de forma efêmera (temporária). Ele é usado como uma área de rascunho (scratch) para salvar os pedaços separados de arquivos de vídeo e áudio grandes antes deles serem integrados em um arquivo final unificado (.mp4 ou .ts). Assim que o vídeo é concluído ou há uma falha, os pedaços são inteiramente deletados dessa memória.
*   **Processamento Seguro (Permissão `offscreen`):** Nós usamos um ambiente oculto fornecido pelo navegador para rodar conversões de mídia pesadas usando FFmpeg diretamente através de WebAssembly no seu processador. Nenhum vídeo é processado na nuvem.
*   **Acesso à Pasta Local (Permissão `downloads`):** Uma vez pronto, o vídeo é repassado ao seu navegador para ser baixado diretamente para sua pasta nativa de Downloads local de forma segura e imediata.

## 2. Compartilhamento de Dados com Terceiros

A extensão "Stream Video Downloader" está livre de rastreamento sistêmico. Não integramos serviços de análise (Analytics), rastreadores de publicidade de terceiros, ou software de telemetria baseados na nuvem. As únicas conexões de rede ativas que a extensão promove ocorrem entre o seu computador e os servidores dos sites que você, enquanto usuário, originou a execução/visualização do vídeo.

## 3. Segurança dos Dados

Garantimos a segurança dos seus dados pelo simples princípio da não-coleta (privacy by design). Todo o ciclo de vida dos seus dados, interceptação de cabeçalhos sensíveis para contornar proteções e o agrupamento final do arquivo (Muxing) ocorre estritamente dentro da Sandbox segura do Chrome/Chromium instalada na máquina do usuário final.

## 4. Alterações nesta Política de Privacidade

Podemos atualizar nossa Política de Privacidade futuramente. Informaremos sobre quaisquer mudanças com antecedência nas respectivas notas de lançamento ou publicando a nova política na página de listagem da loja de extensões para uma revisão transparente.

## 5. Contato

Se você tiver alguma dúvida, sugestão ou preocupação genuína de privacidade relacionada ao uso, permissões ou comportamento do produto durante a utilização, pedimos por gentileza que entre em contato na aba do suporte correspondente e pública presente na Chrome Web Store.
