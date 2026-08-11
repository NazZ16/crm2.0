@echo off
REM Corre os 4 passos do pipeline Maxwork em sequência: se algum falhar,
REM para logo em vez de avançar com dados incompletos (ex.: enviar para
REM o CRM sem teres corrido a extração de detalhe primeiro).
REM
REM 1. maxwork_api_fetch.py    — pesquisa GLOBAL (todas as agências) via
REM    API direta, dividida por fatias de preço para contornar o limite
REM    de 10 000 resultados do motor de busca da Maxwork. Substitui o
REM    antigo maxwork_to_csv.py (esse continua a existir, mas é só por
REM    agência — usa-o à parte se precisares só dos teus imóveis).
REM    Escreve maxwork_imoveis_api.csv. Validado numa corrida real:
REM    47623/47623 imóveis, zero duplicados.
REM 2. maxwork_details_to_csv.py — visita a ficha de cada imóvel e lê
REM    descrição, morada completa, áreas, características e fotos (via
REM    API interna, mais rápido que o separador "Media e Documentos").
REM    Escreve maxwork_imoveis_detalhado.csv.
REM 3. refetch_missing_photos.py — 2ª passagem só pelos imóveis que
REM    ficaram sem fotos no passo 2 (timeout sob carga, mesmo com o
REM    retry por imóvel já embutido) — tipicamente uns 5-10%.
REM 4. maxwork_to_crm.py — envia tudo para o CRM em lote.
REM
REM Uso: copia este ficheiro para a pasta onde tens os scripts e o .env
REM (a mesma pasta de maxwork_api_fetch.py), e corre-o a partir daí (ou
REM agenda-o no Task Scheduler do Windows).
REM
REM Tudo o que os scripts imprimem fica também guardado em
REM scrapers\logs\run_<data-hora>.log — útil quando a janela do terminal
REM fecha sozinha (Task Scheduler, ou logo a seguir a um erro) e não dá
REM para ler o que aconteceu ao vivo.

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set RUNTS=%%i
set MAXWORK_RUN_LOG=%~dp0logs\run_%RUNTS%.log

echo A guardar o relatorio desta corrida em: %MAXWORK_RUN_LOG%
echo.

python maxwork_api_fetch.py
if errorlevel 1 goto :erro

python maxwork_details_to_csv.py maxwork_imoveis_api.csv
if errorlevel 1 goto :erro

python refetch_missing_photos.py
if errorlevel 1 goto :erro

python maxwork_to_crm.py
if errorlevel 1 goto :erro

echo.
echo Concluido com sucesso. Relatorio completo em: %MAXWORK_RUN_LOG%
exit /b 0

:erro
echo.
echo ERRO — um dos passos falhou, a parar aqui.
echo Relatorio completo em: %MAXWORK_RUN_LOG%
exit /b 1
