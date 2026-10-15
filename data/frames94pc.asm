; NHL 94 DOS sprite ranges from Docs/Sprites/Readme.md (NHL 94 DOS section).
; Frame numbers are 1-based (docs index 0 = frame 1). Player sheet 000-875;
; crowd sprites F000-F149 live in separate PPV banks (not this SPF table).
; SPA names and HOCKEY.EXE offsets are not vendored yet (GAP-8).

SPFskaters	=	1	; 000-351 players
SPFdosarrow	=	353	; 352-355 arrows
SPFmouse	=	357	; 356 mouse crosshair
SPFcupaccept	=	358	; 357-358 Stanley Cup accept
SPFfaceoff	=	360	; 359-368 faceoff
SPFanthem	=	370	; 369-371 anthem
SPFlinechange	=	373	; 372-379 line change
SPFanthem2	=	381	; 380-381 anthem
SPFbench	=	383	; 382 bench / penalty box
SPFarrow	=	384	; 383-388 arrows
SPFpad	=	390	; 389-391 star
SPFreplay	=	393	; 392 replay crosshair
SPFpuck	=	394	; 393-403 puck
SPFnet	=	406	; 405-406 nets
SPFgoalie	=	408	; 407-553 goalie
SPFsiren	=	555	; 554-567 goal light
SPFextra	=	569	; 568-643 swat, hook, wobble, flip, injury
SPFglass	=	645	; 644-648 broken glass
SPFref	=	650	; 649-698 referee
SPFbetween	=	700	; 699-702 between plays at bench
SPFrefui	=	704	; 703-871 referee and mouse UI
SPFcupskate	=	873	; 872-875 cup skate
SPFlimit	=	877

SPAList:
	dc.w	0
