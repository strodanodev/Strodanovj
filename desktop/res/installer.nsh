; Strodano VJ installer additions (electron-builder nsis.include). GPL-3.0.
; NDI output: receivers on other computers connect IN to Strodano VJ (NDI's TCP ports from 5960 up, plus mDNS replies),
; so Windows Firewall must let the app take incoming connections. Without a rule Windows only asks once, and closing
; that prompt (or answering it on a network marked Public, which most venue networks are) blocks NDI from every other
; computer while it still works on this one. Resolume, OBS and NDI Tools add their rule at install time too.
; The rule is scoped to this program only (not to ports), on every network profile. Earlier rules for the same program
; (Windows' own prompt answers, allow or block) are replaced so a past "Cancel" does not keep blocking it.
; An install "only for me" runs without admin rights: netsh then fails quietly and the app's NDI panel offers the fix.

!macro customInstall
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name=all dir=in program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="Strodano VJ" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=any'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name=all dir=in program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Pop $0
!macroend
