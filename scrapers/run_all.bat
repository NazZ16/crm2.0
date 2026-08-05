@echo off
REM Corre os 3 scrapers do Maxwork em sequência: se algum passo falhar,
REM para logo em vez de avançar com dados incompletos (ex.: enviar para
REM o CRM sem teres corrido a extração de detalhe primeiro).
REM
REM Uso: copia este ficheiro para a pasta onde tens os scripts e o .env
REM (a mesma pasta de maxwork_to_csv.py), e corre-o a partir daí (ou
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

python maxwork_to_csv.py
if errorlevel 1 goto :erro

python maxwork_details_to_csv.py
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
