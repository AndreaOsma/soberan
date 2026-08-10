; Soberan Windows installer — Inno Setup 6
; Build: scripts\build-desktop.ps1

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

#define AppName "Soberan"
#define AppPublisher "Andrea Osma Rafael"
#define AppExeName "Soberan.exe"
#define BundleDir "..\backend\dist\Soberan"
#define OutputDir "out"

[Setup]
AppId={{A7B3C4D5-E6F7-4890-ABCD-EF1234567890}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=SoberanSetup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: unchecked

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Abrir {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Never delete user data — only app binaries under {app}

[Code]
function InitializeUninstall(): Boolean;
var
  Msg: String;
begin
  Msg := 'Se desinstalará Soberan de este equipo.' + #13#10 + #13#10 +
         'Tus datos financieros en %LOCALAPPDATA%\Soberan\data NO se borrarán.' + #13#10 +
         '¿Continuar?';
  Result := MsgBox(Msg, mbConfirmation, MB_YESNO) = IDYES;
end;
