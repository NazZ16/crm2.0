@echo off
REM Corre os 3 scrapers do Maxwork em sequência: se algum passo falhar,
REM para logo em vez de avançar com dados incompletos (ex.: enviar para
REM o CRM sem teres corrido a extração de detalhe primeiro).
REM
REM Uso: copia este ficheiro para a pasta onde tens os scripts e o .env
REM (a mesma pasta de maxwork_to_csv.py), e corre-o a partir daí (ou
REM agenda-o no Task Scheduler do Windows).

cd /d "%~dp0"

python maxwork_to_csv.py
if errorlevel 1 goto :erro

python maxwork_details_to_csv.py
if errorlevel 1 goto :erro

python maxwork_to_crm.py
if errorlevel 1 goto :erro

echo.
echo Concluido com sucesso.
exit /b 0

:erro
echo.
echo ERRO — um dos passos falhou, a parar aqui.
exit /b 1
