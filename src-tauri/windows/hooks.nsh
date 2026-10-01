; Ganchos do instalador NSIS do Polvo.

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove o "Abrir no Polvo" do menu do Explorer (Shift + clique direito).
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Polvo"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Polvo"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Polvo"
!macroend
