; NHL 96 PC sprite ranges.
; The retail HOCKEY.EXE (NHL96PC SHA-1 426fb8c0c80088c6a2c56a9dac50509cb9c24540)
; has no 94/95-style updateanim SPA table (PC flags-word + eight direction
; offsets). Player pictures live in GAMEART.VIV / ice.fsh SHPI banks, not
; numbered 000_049.PPV sheets. SPF/SPA stay empty until those banks are named
; from the disassembly. The Images tab lists the .FSH names the EXE loads.

SPAlist
	dc.w	0
