@echo off
setlocal
set DIR=%~dp0
set GRADLE_WRAPPER_JAR=%DIR%gradle\wrapper\gradle-wrapper.jar

if not exist "%GRADLE_WRAPPER_JAR%" (
  echo Missing %GRADLE_WRAPPER_JAR%.
  echo Open the project in Android Studio and use "Add Gradle wrapper" or run: gradle wrapper
  exit /b 1
)

java -jar "%GRADLE_WRAPPER_JAR%" %*
