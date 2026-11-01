;	Sprite frame tables. They tell the animation code where each group of frames starts in the sprite graphics
;	and where each animation's list begins.
;
;	First the SPF equates: the first frame number of each group of frames in Sprites.anim. gready has 3 frames
;	per direction (2 in 93), so every base from SPFSiren up is 8 higher than in 93.
;
;	Then SPAlist and one table per animation, in the order of the SPA numbers. The frames after SPFghighr
;	(658) have no SPF name; tables for them list the frame numbers.

; Sprite Frame (SPF) base indices
SPFskatewp	=	1					;skating, stick down
SPFskate	=	SPFskatewp+40		; 41 (skating, stick up)
SPFturnl	=	SPFskate+40			; 81 (turning left)
SPFturnr	=	SPFturnl+8			; 89 (turning right)
SPFswing	=	SPFturnr+8			; 97 (pass and shot swings)
SPFstop	=	SPFswing+48				; 145 (scrape stop)
SPFskateb	=	SPFstop+16			; 161 (skating backwards)
SPFcelebrate	=	SPFskateb+24	; 185 (celebrating)
SPFpump	=	SPFcelebrate+16			; 201 (arm pump)
SPFcup	=	SPFpump+16				; 217 (skating with the cup)
SPFhipl	=	SPFcup+8				; 225 (hip check left)
SPFhipr	=	SPFhipl+8				; 233 (hip check right)
SPFshoulderl	=	SPFhipr+8		; 241 (shoulder check left)
SPFshoulderr	=	SPFshoulderl+8	; 249 (shoulder check right)
SPFsweep	=	SPFshoulderr+8		; 257 (sweep check)

SPFfallback	=	SPFsweep+16			; 273 (falling backward)
SPFfallfwd	=	SPFfallback+32		; 305 (falling forward)
SPFduck	=	SPFfallfwd+32			; 337 (ducking)
SPFHold	=	SPFduck+8				; 345 (holding)

SPFgloves	=	SPFHold+8			; 353 (gloves on the ice (fights), not used by any table)
SPFfight	=	SPFgloves+1			; 354 (fighting, not used by any table)
SPFfinjury	=	SPFfight+17			; 371 (fight injury, not used by any table)
SPFPen	=	SPFfinjury+6			; 377 (frames used by the wall jump animations)

SPFarrow	=	SPFPen+7			; 384 (arrows for off screen players, not used by any table)
SPFpad	=	SPFarrow+6				; 390 (face off pads, not used by any table)
SPFreplay	=	SPFpad+3			; 393 (replay marker, not used by any table)
SPFpuck	=	SPFreplay+1				; 394 (puck)
SPFgoal	=	SPFpuck+11				; 405 (goal, not used by any table)
SPFGoalie	=	SPFgoal+2			; 407 (goalie)
SPFgdive	=	SPFGoalie+112		; 519 (goalie dive)
SPFglovel2	=	SPFgdive+16			; 535 (goalie second glove save)
SPFgready	=	SPFglovel2+4		; 539 (goalie ready)
SPFSiren	=	SPFgready+24		; 563 (siren)

SPFcatch	=	SPFSiren+14			; 577 (catching a puck hit)
SPFhook	=	SPFcatch+16				; 593 (hooking)
SPFstumble	=	SPFhook+16			; 609 (stumbling)
SPFflip	=	SPFstumble+24			; 633 (flipping over)
SPFinjury1	=	SPFflip+8			; 641 (injured on the ice)
SPFbglass	=	SPFinjury1+12		; 653 (glass bang)
SPFslamtop	=	708					; 708 (goalie in the top net slams his stick)
SPFslambot	=	712					; 712 (goalie in the bottom net slams his stick)
SPFghighr	=	658					; 658 (goalie high shoulder save right; the frames after it have no name)

;	Each animation table is: 8 word offsets (one per facing direction 0-7, relative to .t), a flags word
;	(0 or 1), then per direction a list of frame,time word pairs; a negative time ends the list. A SPA value,
;	as kept in SPA(a3), is the offset of its table from SPAlist; SetSPA in checks94.asm switches animation.
;
;	Only the animation equate and table lines are commented. The .0-.7 direction labels and the .a/.b/.c/.off
;	helper symbols are assembler temporaries that step through the SPF frame numbers.

SPAlist								;base of the animation tables; a SPA value is the offset of a table from
									;here
	dc.w	0

SPAgready	=	*-SPAlist			;goalie in ready position
SPAgready_table:					;3 gready frames per direction (93 used 2) and new times
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	1

.0	dc.w	SPFGoalie,180,SPFgready,10,SPFGoalie,10,SPFgready+1,10,SPFGoalie,240,SPFgready+2,10,SPFGoalie,10,SPFgready,-10
.1	dc.w	SPFGoalie+3,180,SPFgready+3,10,SPFGoalie+3,10,SPFgready+4,10,SPFGoalie+3,240,SPFgready+5,10,SPFGoalie+3,10,SPFgready+3,-10
.2	dc.w	SPFGoalie+6,180,SPFgready+6,10,SPFGoalie+6,10,SPFgready+7,10,SPFGoalie+6,240,SPFgready+8,10,SPFGoalie+6,10,SPFgready+6,-10
.3	dc.w	SPFGoalie+9,180,SPFgready+9,10,SPFGoalie+9,10,SPFgready+10,10,SPFGoalie+9,240,SPFgready+11,10,SPFGoalie+9,10,SPFgready+9,-10
.4	dc.w	SPFGoalie+12,180,SPFgready+12,10,SPFGoalie+12,10,SPFgready+13,10,SPFGoalie+12,240,SPFgready+14,10,SPFGoalie+12,10,SPFgready+12,-10
.5	dc.w	SPFGoalie+15,180,SPFgready+15,10,SPFGoalie+15,10,SPFgready+16,10,SPFGoalie+15,240,SPFgready+17,10,SPFGoalie+15,10,SPFgready+15,-10
.6	dc.w	SPFGoalie+18,180,SPFgready+18,10,SPFGoalie+18,10,SPFgready+19,10,SPFGoalie+18,240,SPFgready+20,10,SPFGoalie+18,10,SPFgready+18,-10
.7	dc.w	SPFGoalie+21,180,SPFgready+21,10,SPFGoalie+21,10,SPFgready+22,10,SPFGoalie+21,240,SPFgready+23,10,SPFGoalie+21,10,SPFgready+21,-10

SPAgready2	=	*-SPAlist			;goalie ready position, held frame (used by the goalie scripts)
SPAgready2_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie
.off	=	3

.0	dc.w	.a,-30
.a	set	.a+.off
.1	dc.w	.a,-30
.a	set	.a+.off
.2	dc.w	.a,-30
.a	set	.a+.off
.3	dc.w	.a,-30
.a	set	.a+.off
.4	dc.w	.a,-30
.a	set	.a+.off
.5	dc.w	.a,-30
.a	set	.a+.off
.6	dc.w	.a,-30
.a	set	.a+.off
.7	dc.w	.a,-30

SPAgglover	=	*-SPAlist			;goalie does glove save right
SPAgglover_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie+1
.off	=	3

.0	dc.w	.a,-32
.a	set	.a+.off
.1	dc.w	.a,-32
.a	set	.a+.off
.2	dc.w	.a,-32
.a	set	.a+.off
.3	dc.w	.a,-32
.a	set	.a+.off
.4	dc.w	.a,-32
.a	set	.a+.off
.5	dc.w	.a,-32
.a	set	.a+.off
.6	dc.w	.a,-32
.a	set	.a+.off
.7	dc.w	.a,-32

SPAgglovel	=	*-SPAlist			;goalie does glove save left
SPAgglovel_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie+2
.off	=	3

.0	dc.w	.a,-32
.a	set	.a+.off
.1	dc.w	.a,-32
.a	set	.a+.off
.2	dc.w	.a,-32
.a	set	.a+.off
.3	dc.w	.a,-32
.a	set	.a+.off
.4	dc.w	.a,-32
.a	set	.a+.off
.5	dc.w	.a,-32
.a	set	.a+.off
.6	dc.w	.a,-32
.a	set	.a+.off
.7	dc.w	.a,-32

SPAgglovel2	=	*-SPAlist			;goalie second glove save (SPFglovel2 frames, from the other glove)
SPAgglovel2_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFglovel2
.b	=	SPFGoalie+5

.0	dc.w	.a,4,.a+1,8,.a,-4
.1	dc.w	.b,-32
.2	dc.w	.b+3,-32
.3	dc.w	.b+6,-32
.4	dc.w	.a+2,4,.a+3,8,.a+2,-4
.5	dc.w	.b+12,-32
.6	dc.w	.b+15,-32
.7	dc.w	.b+18,-32

SPAgstickr	=	*-SPAlist			;goalie stick save right
SPAgstickr_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie+64
.off	=	2

.0	dc.w	.a,-32
.a	set	.a+.off
.1	dc.w	.a,-32
.a	set	.a+.off
.2	dc.w	.a,-32
.a	set	.a+.off
.3	dc.w	.a,-32
.a	set	.a+.off
.4	dc.w	.a,-32
.a	set	.a+.off
.5	dc.w	.a,-32
.a	set	.a+.off
.6	dc.w	.a,-32
.a	set	.a+.off
.7	dc.w	.a,-32

SPAgstickl	=	*-SPAlist			;goalie stick save left
SPAgstickl_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie+65
.off	=	2

.0	dc.w	.a,-32
.a	set	.a+.off
.1	dc.w	.a,-32
.a	set	.a+.off
.2	dc.w	.a,-32
.a	set	.a+.off
.3	dc.w	.a,-32
.a	set	.a+.off
.4	dc.w	.a,-32
.a	set	.a+.off
.5	dc.w	.a,-32
.a	set	.a+.off
.6	dc.w	.a,-32
.a	set	.a+.off
.7	dc.w	.a,-32

SPAgstackr	=	*-SPAlist			;goalie stack (pad save) right
SPAgstackr_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie+40

.0	dc.w	.a,8,.a+1,-32
.1	dc.w	.a+2,8,.a+3,-32
.2	dc.w	.a+2,8,.a+3,-32
.3	dc.w	.a+4,8,.a+5,-32
.4	dc.w	.a+6,8,.a+7,-32
.5	dc.w	.a+8,8,.a+9,-32
.6	dc.w	.a+8,8,.a+9,-32
.7	dc.w	.a+10,8,.a+11,-32

SPAgstackl	=	*-SPAlist			;goalie stack (pad save) left
SPAgstackl_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie+52

.0	dc.w	.a,8,.a+1,-32
.1	dc.w	.a+2,8,.a+3,-32
.2	dc.w	.a+2,8,.a+3,-32
.3	dc.w	.a+4,8,.a+5,-32
.4	dc.w	.a+6,8,.a+7,-32
.5	dc.w	.a+8,8,.a+9,-32
.6	dc.w	.a+8,8,.a+9,-32
.7	dc.w	.a+10,8,.a+11,-32

SPAgdive	=	*-SPAlist			;goalie diving save (SPFgdive frames)
SPAgdive_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFgdive
.off	=	2

.0	dc.w	.a,8,.a+1,48,.a,-8
.a	set	.a+.off
.1	dc.w	.a,8,.a+1,48,.a,-8
.a	set	.a+.off
.2	dc.w	.a,8,.a+1,48,.a,-8
.a	set	.a+.off
.3	dc.w	.a,8,.a+1,48,.a,-8
.a	set	.a+.off
.4	dc.w	.a,8,.a+1,48,.a,-8
.a	set	.a+.off
.5	dc.w	.a,8,.a+1,48,.a,-8
.a	set	.a+.off
.6	dc.w	.a,8,.a+1,48,.a,-8
.a	set	.a+.off
.7	dc.w	.a,8,.a+1,48,.a,-8

SPAgswing	=	*-SPAlist			;goalie passes puck
SPAgswing_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie+24
.off	=	2

.0	dc.w	.a,5,.a+1,8,.a,-16
.a	set	.a+.off
.1	dc.w	.a,5,.a+1,8,.a,-16
.a	set	.a+.off
.2	dc.w	.a,5,.a+1,8,.a,-16
.a	set	.a+.off
.3	dc.w	.a,5,.a+1,8,.a,-16
.a	set	.a+.off
.4	dc.w	.a,5,.a+1,8,.a,-16
.a	set	.a+.off
.5	dc.w	.a,5,.a+1,8,.a,-16
.a	set	.a+.off
.6	dc.w	.a,5,.a+1,8,.a,-16
.a	set	.a+.off
.7	dc.w	.a,5,.a+1,8,.a,-16

SPAgskate	=	*-SPAlist			;goalie skates
SPAgskate_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFGoalie+80
.off	=	4

.0	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-15
.a	set	.a+.off
.1	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-15
.a	set	.a+.off
.2	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-15
.a	set	.a+.off
.3	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-15
.a	set	.a+.off
.4	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-15
.a	set	.a+.off
.5	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-15
.a	set	.a+.off
.6	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-15
.a	set	.a+.off
.7	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-15

SPApflip	=	*-SPAlist			;puck animation (flipping puck)
SPApflip_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	1

.a	=	SPFpuck+1

.0	dc.w	.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,4,.a+2,4,.a+6,4,.a,-4
.1	dc.w	.a+8,2,.a,2,.a+7,2,.a+4,2,.a+9,2,.a+4,2,.a+7,2,.a,-2
.2	dc.w	.a+3,2,.a+2,2,.a+1,2,.a,2,.a+6,2,.a+2,2,.a+5,2,.a+4,-2
.3	dc.w	.a+7,4,.a,4,.a+8,4,.a,4,.a+7,4,.a+4,4,.a+9,4,.a+4,-4
.4	dc.w	.a,-4096
.5	dc.w	.a,-4096
.6	dc.w	.a+4,-4096
.7	dc.w	.a+4,-4096

SPAglide	=	*-SPAlist			;player gliding with stick down
SPAglide_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFskatewp
.off	=	5

.0	dc.w	.a,-8
.a	set	.a+.off
.1	dc.w	.a,-8
.a	set	.a+.off
.2	dc.w	.a,-8
.a	set	.a+.off
.3	dc.w	.a,-8
.a	set	.a+.off
.4	dc.w	.a,-8
.a	set	.a+.off
.5	dc.w	.a,-8
.a	set	.a+.off
.6	dc.w	.a,-8
.a	set	.a+.off
.7	dc.w	.a,-8

SPAskatewp	=	*-SPAlist			;player skating with stick down (SPFskatewp frames)
SPAskatewp_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFskatewp+1
.off	=	5

.0	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.1	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.2	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.3	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.4	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.5	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.6	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.7	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10

SPAskate	=	*-SPAlist			;player skating with stick up (SPFskate frames)
SPAskate_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFskate+1
.off	=	5

.0	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.1	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.2	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.3	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.4	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.5	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.6	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10
.a	set	.a+.off
.7	dc.w	.a,10,.a+1,10,.a+2,10,.a+3,-10

SPAturnl	=	*-SPAlist			;player turning left
SPAturnl_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFturnl
.off	=	1

.0	dc.w	.a,-8
.a	set	.a+.off
.1	dc.w	.a,-8
.a	set	.a+.off
.2	dc.w	.a,-8
.a	set	.a+.off
.3	dc.w	.a,-8
.a	set	.a+.off
.4	dc.w	.a,-8
.a	set	.a+.off
.5	dc.w	.a,-8
.a	set	.a+.off
.6	dc.w	.a,-8
.a	set	.a+.off
.7	dc.w	.a,-8

SPAturnr	=	*-SPAlist			;player turning right
SPAturnr_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFturnr
.off	=	1

.0	dc.w	.a,-8
.a	set	.a+.off
.1	dc.w	.a,-8
.a	set	.a+.off
.2	dc.w	.a,-8
.a	set	.a+.off
.3	dc.w	.a,-8
.a	set	.a+.off
.4	dc.w	.a,-8
.a	set	.a+.off
.5	dc.w	.a,-8
.a	set	.a+.off
.6	dc.w	.a,-8
.a	set	.a+.off
.7	dc.w	.a,-8

SPAstop	=	*-SPAlist				;player scrape stopping
SPAstop_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	1

.a	=	SPFstop
.off	=	2

.0	dc.w	.a,4,.a+1,-4
.a	set	.a+.off
.1	dc.w	.a,4,.a+1,-4
.a	set	.a+.off
.2	dc.w	.a,4,.a+1,-4
.a	set	.a+.off
.3	dc.w	.a,4,.a+1,-4
.a	set	.a+.off
.4	dc.w	.a,4,.a+1,-4
.a	set	.a+.off
.5	dc.w	.a,4,.a+1,-4
.a	set	.a+.off
.6	dc.w	.a,4,.a+1,-4
.a	set	.a+.off
.7	dc.w	.a,4,.a+1,-4

SPApassf	=	*-SPAlist			;forward pass swing
SPApassf_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFswing+3
.off	=	6

.0	dc.w	.a,4,.a+1,4,.a+2,-20
.a	set	.a+.off
.1	dc.w	.a,4,.a+1,4,.a+2,-20
.a	set	.a+.off
.2	dc.w	.a,4,.a+1,4,.a+2,-20
.a	set	.a+.off
.3	dc.w	.a,4,.a+1,4,.a+2,-20
.a	set	.a+.off
.4	dc.w	.a,4,.a+1,4,.a+2,-20
.a	set	.a+.off
.5	dc.w	.a,4,.a+1,4,.a+2,-20
.a	set	.a+.off
.6	dc.w	.a,4,.a+1,4,.a+2,-20
.a	set	.a+.off
.7	dc.w	.a,4,.a+1,4,.a+2,-20

SPApassb	=	*-SPAlist			;back hand pass swing
SPApassb_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFswing+1
.off	=	6

.0	dc.w	.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.1	dc.w	.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.2	dc.w	.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.3	dc.w	.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.4	dc.w	.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.5	dc.w	.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.6	dc.w	.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.7	dc.w	.a+2,4,.a+1,4,.a,-20

SPAshotf	=	*-SPAlist			;player shoots forehand
SPAshotf_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFswing
.off	=	6

.0	dc.w	.a+3,4,.a+2,4,.a+1,4,.a,4,.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,-20
.a	set	.a+.off
.1	dc.w	.a+3,4,.a+2,4,.a+1,4,.a,4,.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,-20
.a	set	.a+.off
.2	dc.w	.a+3,4,.a+2,4,.a+1,4,.a,4,.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,-20
.a	set	.a+.off
.3	dc.w	.a+3,4,.a+2,4,.a+1,4,.a,4,.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,-20
.a	set	.a+.off
.4	dc.w	.a+3,4,.a+2,4,.a+1,4,.a,4,.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,-20
.a	set	.a+.off
.5	dc.w	.a+3,4,.a+2,4,.a+1,4,.a,4,.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,-20
.a	set	.a+.off
.6	dc.w	.a+3,4,.a+2,4,.a+1,4,.a,4,.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,-20
.a	set	.a+.off
.7	dc.w	.a+3,4,.a+2,4,.a+1,4,.a,4,.a+1,4,.a+2,4,.a+3,4,.a+4,4,.a+5,-20

SPAshotb	=	*-SPAlist			;player shoots backhand
SPAshotb_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFswing+1
.off	=	6

.0	dc.w	.a+2,4,.a+3,4,.a+4,4,.a+4,4,.a+4,4,.a+3,4,.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.1	dc.w	.a+2,4,.a+3,4,.a+4,4,.a+4,4,.a+4,4,.a+3,4,.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.2	dc.w	.a+2,4,.a+3,4,.a+4,4,.a+4,4,.a+4,4,.a+3,4,.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.3	dc.w	.a+2,4,.a+3,4,.a+4,4,.a+4,4,.a+4,4,.a+3,4,.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.4	dc.w	.a+2,4,.a+3,4,.a+4,4,.a+4,4,.a+4,4,.a+3,4,.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.5	dc.w	.a+2,4,.a+3,4,.a+4,4,.a+4,4,.a+4,4,.a+3,4,.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.6	dc.w	.a+2,4,.a+3,4,.a+4,4,.a+4,4,.a+4,4,.a+3,4,.a+2,4,.a+1,4,.a,-20
.a	set	.a+.off
.7	dc.w	.a+2,4,.a+3,4,.a+4,4,.a+4,4,.a+4,4,.a+3,4,.a+2,4,.a+1,4,.a,-20

SPAglideback	=	*-SPAlist		;player gliding backwards
SPAglideback_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFskateb
.off	=	3

.0	dc.w	.a,-8
.a	set	.a+.off
.1	dc.w	.a,-8
.a	set	.a+.off
.2	dc.w	.a,-8
.a	set	.a+.off
.3	dc.w	.a,-8
.a	set	.a+.off
.4	dc.w	.a,-8
.a	set	.a+.off
.5	dc.w	.a,-8
.a	set	.a+.off
.6	dc.w	.a,-8
.a	set	.a+.off
.7	dc.w	.a,-8

SPAskateback	=	*-SPAlist		;player skating backwards
SPAskateback_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFskateb
.off	=	3

.0	dc.w	.a,10,.a+1,10,.a,10,.a+2,-10
.a	set	.a+.off
.1	dc.w	.a,10,.a+1,10,.a,10,.a+2,-10
.a	set	.a+.off
.2	dc.w	.a,10,.a+1,10,.a,10,.a+2,-10
.a	set	.a+.off
.3	dc.w	.a,10,.a+1,10,.a,10,.a+2,-10
.a	set	.a+.off
.4	dc.w	.a,10,.a+1,10,.a,10,.a+2,-10
.a	set	.a+.off
.5	dc.w	.a,10,.a+1,10,.a,10,.a+2,-10
.a	set	.a+.off
.6	dc.w	.a,10,.a+1,10,.a,10,.a+2,-10
.a	set	.a+.off
.7	dc.w	.a,10,.a+1,10,.a,10,.a+2,-10

SPAsweepchk	=	*-SPAlist			;player stick (sweep) checking
SPAsweepchk_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFsweep
.off	=	2

.0	dc.w	.a,4,.a+1,8,.a,-4
.a	set	.a+.off
.1	dc.w	.a,4,.a+1,8,.a,-4
.a	set	.a+.off
.2	dc.w	.a,4,.a+1,8,.a,-4
.a	set	.a+.off
.3	dc.w	.a,4,.a+1,8,.a,-4
.a	set	.a+.off
.4	dc.w	.a,4,.a+1,8,.a,-4
.a	set	.a+.off
.5	dc.w	.a,4,.a+1,8,.a,-4
.a	set	.a+.off
.6	dc.w	.a,4,.a+1,8,.a,-4
.a	set	.a+.off
.7	dc.w	.a,4,.a+1,8,.a,-4

SPAshoulderchkl	=	*-SPAlist		;player shoulder checking left
SPAshoulderchkl_table:				;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFshoulderl
.off	=	1

.0	dc.w	.a,-24
.a	set	.a+.off
.1	dc.w	.a,-24
.a	set	.a+.off
.2	dc.w	.a,-24
.a	set	.a+.off
.3	dc.w	.a,-24
.a	set	.a+.off
.4	dc.w	.a,-24
.a	set	.a+.off
.5	dc.w	.a,-24
.a	set	.a+.off
.6	dc.w	.a,-24
.a	set	.a+.off
.7	dc.w	.a,-24

SPAshoulderchkr	=	*-SPAlist		;player shoulder checking right
SPAshoulderchkr_table:				;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFshoulderr
.off	=	1

.0	dc.w	.a,-24
.a	set	.a+.off
.1	dc.w	.a,-24
.a	set	.a+.off
.2	dc.w	.a,-24
.a	set	.a+.off
.3	dc.w	.a,-24
.a	set	.a+.off
.4	dc.w	.a,-24
.a	set	.a+.off
.5	dc.w	.a,-24
.a	set	.a+.off
.6	dc.w	.a,-24
.a	set	.a+.off
.7	dc.w	.a,-24

SPAhipchkl	=	*-SPAlist			;player hip checking left
SPAhipchkl_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFhipl
.off	=	1

.0	dc.w	.a,-24
.a	set	.a+.off
.1	dc.w	.a,-24
.a	set	.a+.off
.2	dc.w	.a,-24
.a	set	.a+.off
.3	dc.w	.a,-24
.a	set	.a+.off
.4	dc.w	.a,-24
.a	set	.a+.off
.5	dc.w	.a,-24
.a	set	.a+.off
.6	dc.w	.a,-24
.a	set	.a+.off
.7	dc.w	.a,-24

SPAhipchkr	=	*-SPAlist			;player hip checking right
SPAhipchkr_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFhipr
.off	=	1

.0	dc.w	.a,-24
.a	set	.a+.off
.1	dc.w	.a,-24
.a	set	.a+.off
.2	dc.w	.a,-24
.a	set	.a+.off
.3	dc.w	.a,-24
.a	set	.a+.off
.4	dc.w	.a,-24
.a	set	.a+.off
.5	dc.w	.a,-24
.a	set	.a+.off
.6	dc.w	.a,-24
.a	set	.a+.off
.7	dc.w	.a,-24

SPAburst	=	*-SPAlist			;player doing c button (speed/no check)
SPAburst_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFskate
.off	=	5

.0	dc.w	.a,-24
.a	set	.a+.off
.1	dc.w	.a,-24
.a	set	.a+.off
.2	dc.w	.a,-24
.a	set	.a+.off
.3	dc.w	.a,-24
.a	set	.a+.off
.4	dc.w	.a,-24
.a	set	.a+.off
.5	dc.w	.a,-24
.a	set	.a+.off
.6	dc.w	.a,-24
.a	set	.a+.off
.7	dc.w	.a,-24

SPAHold	=	*-SPAlist				;player trying to hold
SPAHold_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFHold
.off	=	1

.0	dc.w	.a,-30
.a	set	.a+.off
.1	dc.w	.a,-30
.a	set	.a+.off
.2	dc.w	.a,-30
.a	set	.a+.off
.3	dc.w	.a,-30
.a	set	.a+.off
.4	dc.w	.a,-30
.a	set	.a+.off
.5	dc.w	.a,-30
.a	set	.a+.off
.6	dc.w	.a,-30
.a	set	.a+.off
.7	dc.w	.a,-30

SPAHold2	=	*-SPAlist			;player holding opponent
SPAHold2_table:						;last time -40 in every direction (93 used -30)
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	SPFHold,-40
.1	dc.w	SPFHold+1,-40
.2	dc.w	SPFHold+2,-40
.3	dc.w	SPFHold+3,-40
.4	dc.w	SPFHold+4,-40
.5	dc.w	SPFHold+5,-40
.6	dc.w	SPFHold+6,-40
.7	dc.w	SPFHold+7,-40

SPAflail	=	*-SPAlist			;player being held by opponent
SPAflail_table:						;last time -40 in every direction (93 used -30)
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	SPFskate,-40
.1	dc.w	SPFskate+5,-40
.2	dc.w	SPFskate+10,-40
.3	dc.w	SPFskate+15,-40
.4	dc.w	SPFskate+20,-40
.5	dc.w	SPFskate+25,-40
.6	dc.w	SPFskate+30,-40
.7	dc.w	SPFskate+35,-40

SPAfallfwd	=	*-SPAlist			;player falling forward
SPAfallfwd_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFfallfwd
.off	=	4
.b	=	SPFduck
.boff	=	1

.0	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.1	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.2	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.3	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.4	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.5	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.6	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.7	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8

SPAfallback	=	*-SPAlist			;player falling backward
SPAfallback_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFfallback
.off	=	4
.b	=	SPFduck
.boff	=	1

.0	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.1	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.2	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.3	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.4	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.5	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.6	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8
.a	set	.a+.off
.b	set	.b+.boff
.7	dc.w	.a,6,.a+1,6,.a+2,100,.a+3,8,.b,-8

SPAcelebrate	=	*-SPAlist		;player raising stick/arms up
SPAcelebrate_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFcelebrate
.off	=	2

.0	dc.w	.a,12,.a+1,40,.a,-5
.a	set	.a+.off
.1	dc.w	.a,12,.a+1,40,.a,-5
.a	set	.a+.off
.2	dc.w	.a,12,.a+1,40,.a,-5
.a	set	.a+.off
.3	dc.w	.a,12,.a+1,40,.a,-5
.a	set	.a+.off
.4	dc.w	.a,12,.a+1,40,.a,-5
.a	set	.a+.off
.5	dc.w	.a,12,.a+1,40,.a,-5
.a	set	.a+.off
.6	dc.w	.a,12,.a+1,40,.a,-5
.a	set	.a+.off
.7	dc.w	.a,12,.a+1,40,.a,-5

SPApump	=	*-SPAlist				;player doing pump (arm pump) animation
SPApump_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFpump
.off	=	2

.0	dc.w	.a,8,.a+1,8,.a,-8
.a	set	.a+.off
.1	dc.w	.a,8,.a+1,8,.a,-8
.a	set	.a+.off
.2	dc.w	.a,8,.a+1,8,.a,-8
.a	set	.a+.off
.3	dc.w	.a,8,.a+1,8,.a,-8
.a	set	.a+.off
.4	dc.w	.a,8,.a+1,8,.a,-8
.a	set	.a+.off
.5	dc.w	.a,8,.a+1,8,.a,-8
.a	set	.a+.off
.6	dc.w	.a,8,.a+1,8,.a,-8
.a	set	.a+.off
.7	dc.w	.a,8,.a+1,8,.a,-8

SPAwallright	=	*-SPAlist		;player jumps wall with legs to the right
SPAwallright_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFPen

.0	dc.w	.a+4,8,.a+5,8,.a+6,-8
.1
.2	dc.w	.a,8,.a+1,8,.a+2,8,.a+3,-8
.3
.4
.5
.6	dc.w	.a+3,8,.a+2,8,.a+1,8,.a,-8
.7									; (skipped)

SPAwallleft	=	*-SPAlist			;player jumps wall with legs to the left
SPAwallleft_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFPen

.0	dc.w	.a+6,8,.a+5,8,.a+4,-8
.1
.2	dc.w	.a+3,8,.a+2,8,.a+1,8,.a,-8
.3
.4
.5
.6	dc.w	.a,8,.a+1,8,.a+2,8,.a+3,-8
.7									; (skipped)

SPAfaceoff	=	*-SPAlist			;player does faceoff stick check
SPAfaceoff_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFskatewp
.b	=	SPFsweep

.0	dc.w	.a,2,.b+1,10,.b,-6
.1
.2
.3
.4
.5
.6
.7	dc.w	.a+20,2,.b+9,10,.b+8,-6

SPAfaceoffr	=	*-SPAlist			;ready position for faceoff
SPAfaceoffr_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFskatewp

.0	dc.w	.a,-5
.1
.2
.3
.4
.5
.6
.7	dc.w	.a+20,-5

SPAsiren	=	*-SPAlist			;siren animation
SPAsiren_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	1

.a	=	SPFSiren

.0
.1
.2
.3
.4
.5
.6
.7	dc.w	.a,3,.a+1,3,.a+2,3,.a+3,3,.a+4,3,.a+5,3,.a+6,3,.a+7,3,.a+8,3,.a+9,3,.a+10,3,.a+11,3,.a+12,3,.a+13,-3

SPAbglass	=	*-SPAlist			;puck hits the glass: glass bang animation (SPFbglass frames)
SPAbglass_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFbglass

.0
.1
.2
.3
.4
.5
.6
.7	dc.w	.a,8,.a+1,8,.a+2,8,.a+3,8,.a+4,-1000

SPAstanley	=	*-SPAlist			;player skates with stanley cup over head
SPAstanley_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	1

.a	=	SPFcup
.off	=	1

.0	dc.w	.a,-30
.a	set	.a+.off
.1	dc.w	.a,-30
.a	set	.a+.off
.2	dc.w	.a,-30
.a	set	.a+.off
.3	dc.w	.a,-30
.a	set	.a+.off
.4	dc.w	.a,-30
.a	set	.a+.off
.5	dc.w	.a,-30
.a	set	.a+.off
.6	dc.w	.a,-30
.a	set	.a+.off
.7	dc.w	.a,-30

SPAcatch	=	*-SPAlist			;player hit by a slower puck (puckbody)
SPAcatch_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFcatch
.off	=	2

.0	dc.w	.a,6,.a+1,-6
.a	set	.a+.off
.1	dc.w	.a,6,.a+1,-6
.a	set	.a+.off
.2	dc.w	.a,6,.a+1,-6
.a	set	.a+.off
.3	dc.w	.a,6,.a+1,-6
.a	set	.a+.off
.4	dc.w	.a,6,.a+1,-6
.a	set	.a+.off
.5	dc.w	.a,6,.a+1,-6
.a	set	.a+.off
.6	dc.w	.a,6,.a+1,-6
.a	set	.a+.off
.7	dc.w	.a,6,.a+1,-6

SPAhook	=	*-SPAlist				;player hooking, also a hold animation
SPAhook_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFhook
.off	=	2

.0	dc.w	.a,-30
.a	set	.a+.off
.1	dc.w	.a,-30
.a	set	.a+.off
.2	dc.w	.a,-30
.a	set	.a+.off
.3	dc.w	.a,-30
.a	set	.a+.off
.4	dc.w	.a,-30
.a	set	.a+.off
.5	dc.w	.a,-30
.a	set	.a+.off
.6	dc.w	.a,-30
.a	set	.a+.off
.7	dc.w	.a,-30

SPAhook2	=	*-SPAlist			;holding animation after SPAhook
SPAhook2_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFhook
.off	=	2

.0	dc.w	.a,9,.a+1,9,.a,9,.a+1,-9
.a	set	.a+.off
.1	dc.w	.a,9,.a+1,9,.a,9,.a+1,-9
.a	set	.a+.off
.2	dc.w	.a,9,.a+1,9,.a,9,.a+1,-9
.a	set	.a+.off
.3	dc.w	.a,9,.a+1,9,.a,9,.a+1,-9
.a	set	.a+.off
.4	dc.w	.a,9,.a+1,9,.a,9,.a+1,-9
.a	set	.a+.off
.5	dc.w	.a,9,.a+1,9,.a,9,.a+1,-9
.a	set	.a+.off
.6	dc.w	.a,9,.a+1,9,.a,9,.a+1,-9
.a	set	.a+.off
.7	dc.w	.a,9,.a+1,9,.a,9,.a+1,-9

SPAstumble	=	*-SPAlist			;player stumbles instead of falling
SPAstumble_table:					;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFstumble
.off	=	3

.0	dc.w	.a,6,.a+1,6,.a+2,8,.a+1,6,.a,-6
.a	set	.a+.off
.1	dc.w	.a,6,.a+1,6,.a+2,8,.a+1,6,.a,-6
.a	set	.a+.off
.2	dc.w	.a,6,.a+1,6,.a+2,8,.a+1,6,.a,-6
.a	set	.a+.off
.3	dc.w	.a,6,.a+1,6,.a+2,8,.a+1,6,.a,-6
.a	set	.a+.off
.4	dc.w	.a,6,.a+1,6,.a+2,8,.a+1,6,.a,-6
.a	set	.a+.off
.5	dc.w	.a,6,.a+1,6,.a+2,8,.a+1,6,.a,-6
.a	set	.a+.off
.6	dc.w	.a,6,.a+1,6,.a+2,8,.a+1,6,.a,-6
.a	set	.a+.off
.7	dc.w	.a,6,.a+1,6,.a+2,8,.a+1,6,.a,-6

SPAfake	=	*-SPAlist				;skater fake: turn left, sweep, turn right frames
SPAfake_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFturnl
.b	=	SPFsweep
.c	=	SPFturnr

.0	dc.w	.a,4,.a+7,4,.b+12,20,.c+7,4,.c,4,.c+1,-4
.1	dc.w	.a+1,4,.a,4,.b+14,20,.c,4,.c+1,4,.c+2,-4
.2	dc.w	.a+2,4,.a+1,4,.b,20,.c+1,4,.c+2,4,.c+3,-4
.3	dc.w	.a+3,4,.a+2,4,.b+2,20,.c+2,4,.c+3,4,.c+4,-4
.4	dc.w	.a+4,4,.a+3,4,.b+4,20,.c+3,4,.c+4,4,.c+5,-4
.5	dc.w	.a+5,4,.a+4,4,.b+6,20,.c+4,4,.c+5,4,.c+6,-4
.6	dc.w	.a+6,4,.a+5,4,.b+8,20,.c+5,4,.c+6,4,.c+7,-4
.7	dc.w	.a+7,4,.a+6,4,.b+10,20,.c+6,4,.c+7,4,.c,-4

SPAflip	=	*-SPAlist				;player flips over, third fall animation
SPAflip_table:						;table of the animation above: direction offsets, flags, frame/time lists
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.a	=	SPFflip
.b	=	SPFfallback+2
.boff	=	4
.c	=	SPFduck
.coff	=	1

.0	dc.w	.a,6,.a+1,6,.a+2,6,.a+3,6,.b,100,.b+1,8,.c,-8
.b	set	.b+.boff
.c	set	.c+.coff
.1	dc.w	.a,6,.a+1,6,.a+2,6,.a+3,6,.b,100,.b+1,8,.c,-8
.b	set	.b+.boff
.c	set	.c+.coff
.2	dc.w	.a,6,.a+1,6,.a+2,6,.a+3,6,.b,100,.b+1,8,.c,-8
.b	set	.b+.boff
.c	set	.c+.coff
.3	dc.w	.a+4,6,.a+5,6,.a+6,6,.a+7,6,.b,100,.b+1,8,.c,-8
.b	set	.b+.boff
.c	set	.c+.coff
.4	dc.w	.a+4,6,.a+5,6,.a+6,6,.a+7,6,.b,100,.b+1,8,.c,-8
.b	set	.b+.boff
.c	set	.c+.coff
.5	dc.w	.a+4,6,.a+5,6,.a+6,6,.a+7,6,.b,100,.b+1,8,.c,-8
.b	set	.b+.boff
.c	set	.c+.coff
.6	dc.w	.a+4,6,.a+5,6,.a+6,6,.a+7,6,.b,100,.b+1,8,.c,-8
.b	set	.b+.boff
.c	set	.c+.coff
.7	dc.w	.a,6,.a+1,6,.a+2,6,.a+3,6,.b,100,.b+1,8,.c,-8

SPAinjuryfall	=	*-SPAlist		;Fall back and stay down: the injured player (FallDown, before
									;setInjuryType)
SPAinjuryfall_table:				;Frames 273-291
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0
.1
.2
.7	dc.w	SPFfallback,6,SPFfallback+1,6,SPFfallback+2,30,SPFfallback+2,-1024
.3
.4
.5
.6	dc.w	SPFfallback+16,6,SPFfallback+17,6,SPFfallback+18,30,SPFfallback+18,-1024

SPAghighr	=	*-SPAlist			;Goalie high shoulder save right (goaliesave.saveanim 6)
SPAghighr_table:					;Frames 658-672
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	658,-32
.1	dc.w	660,-32
.2	dc.w	662,-32
.3	dc.w	664,-32
.4	dc.w	666,-32
.5	dc.w	668,-32
.6	dc.w	670,-32
.7	dc.w	672,-32

SPAghighl	=	*-SPAlist			;Goalie high shoulder save left (goaliesave.saveanim 7)
SPAghighl_table:					;Frames 659-673
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	659,-32
.1	dc.w	661,-32
.2	dc.w	663,-32
.3	dc.w	665,-32
.4	dc.w	667,-32
.5	dc.w	669,-32
.6	dc.w	671,-32
.7	dc.w	673,-32

SPAgstick2r	=	*-SPAlist			;Goalie stick save right, 2 frames (goaliesave.saveanim 8)
SPAgstick2r_table:					;Frames 674-703
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	674,4,675,-32
.1	dc.w	678,4,679,-32
.2	dc.w	682,4,683,-32
.3	dc.w	686,4,687,-32
.4	dc.w	690,4,691,-32
.5	dc.w	694,4,695,-32
.6	dc.w	698,4,699,-32
.7	dc.w	702,4,703,-32

SPAgstick2l	=	*-SPAlist			;Goalie stick save left, 2 frames (goaliesave.saveanim 9)
SPAgstick2l_table:					;Frames 676-705
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	676,4,677,-32
.1	dc.w	680,4,681,-32
.2	dc.w	684,4,685,-32
.3	dc.w	688,4,689,-32
.4	dc.w	692,4,693,-32
.5	dc.w	696,4,697,-32
.6	dc.w	700,4,701,-32
.7	dc.w	704,4,705,-32

SPAgslamtop	=	*-SPAlist			;Goalie in the top net (pfgoal 0) turns and slams his stick after a
									;goal: sfx $1C on frame SPFslamtop (assgoaliecpu)
SPAgslamtop_table:					;Frames 407-709
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	706,5,707,5,SPFslamtop,10,SPFslamtop+1,-5
.1	dc.w	SPFGoalie+3,8,SPFGoalie,8,706,5,707,5,SPFslamtop,10,SPFslamtop+1,-5
.2	dc.w	SPFGoalie+6,8,SPFGoalie+3,8,SPFGoalie+3,8,706,5,707,5,SPFslamtop,10,SPFslamtop+1,-5
.3	dc.w	SPFGoalie+9,8,SPFGoalie+6,8,SPFGoalie+6,8,SPFGoalie+6,8,706,5,707,5,SPFslamtop,10,SPFslamtop+1,-5
.4	dc.w	SPFGoalie+12,8,SPFGoalie+9,8,SPFGoalie+9,8,SPFGoalie+9,8,SPFGoalie+9,8,706,5,707,5,SPFslamtop,10
	dc.w	SPFslamtop+1,-5
.5	dc.w	SPFGoalie+15,8,SPFGoalie+18,8,SPFGoalie+18,8,SPFGoalie+18,8,706,5,707,5,SPFslamtop,10,SPFslamtop+1,-5
.6	dc.w	SPFGoalie+18,8,SPFGoalie+21,8,SPFGoalie+21,8,706,5,707,5,SPFslamtop,10,SPFslamtop+1,-5
.7	dc.w	SPFGoalie+21,8,SPFGoalie+24,8,706,5,707,5,SPFslamtop,10,SPFslamtop+1,-5

SPAgslambot	=	*-SPAlist			;Goalie in the bottom net (pfgoal 1) turns and slams his stick
									;after a goal: sfx $1C on frame SPFslambot (assgoaliecpu)
SPAgslambot_table:					;Frames 407-713
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	SPFGoalie,8,SPFGoalie+3,8,SPFGoalie+3,8,SPFGoalie+3,8,SPFGoalie+3,8,710,5,711,5,SPFslambot,10
	dc.w	SPFslambot+1,-5
.1	dc.w	SPFGoalie+3,8,SPFGoalie+6,8,SPFGoalie+6,8,SPFGoalie+6,8,710,5,711,5,SPFslambot,10,SPFslambot+1,-5
.2	dc.w	SPFGoalie+6,8,SPFGoalie+9,8,SPFGoalie+9,8,710,5,711,5,SPFslambot,10,SPFslambot+1,-5
.3	dc.w	SPFGoalie+9,8,SPFGoalie+12,8,710,5,711,5,SPFslambot,10,SPFslambot+1,-5
.4	dc.w	SPFGoalie+12,8,710,5,711,5,SPFslambot,10,SPFslambot+1,-5
.5	dc.w	SPFGoalie+15,8,SPFGoalie+12,8,710,5,711,5,SPFslambot,10,SPFslambot+1,-5
.6	dc.w	SPFGoalie+18,8,SPFGoalie+15,8,SPFGoalie+15,8,710,5,711,5,SPFslambot,10,SPFslambot+1,-5
.7	dc.w	SPFGoalie+21,8,SPFGoalie+18,8,SPFGoalie+18,8,SPFGoalie+18,8,710,5,711,5,SPFslambot,10,SPFslambot+1,-5

SPAboardfront	=	*-SPAlist		;Checked into the end boards behind the top goal line
									;(FallDown.FallList 0)
SPAboardfront_table:				;Frames 276-753
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0
.1	dc.w	738,6,739,6,740,6,741,60,SPFfallback+3,8,SPFduck,-8
.2
.3	dc.w	742,6,743,6,744,6,745,60,SPFfallfwd+11,8,SPFduck+2,-8
.4
.5	dc.w	746,6,747,6,748,6,749,60,SPFfallfwd+19,8,SPFduck+4,-8
.6
.7	dc.w	750,6,751,6,752,6,753,60,SPFfallfwd+27,8,SPFduck+6,-8

SPAboardright	=	*-SPAlist		;Checked into the right side boards (FallDown.FallList 1; flipped
									;sprites swap it with SPAboardleft)
SPAboardright_table:				;Frames 284-769
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0
.1	dc.w	754,6,755,6,756,6,757,60,SPFfallfwd+3,8,SPFduck,-8
.2
.3	dc.w	758,6,759,6,760,6,761,60,SPFfallback+11,8,SPFduck+2,-8
.4
.5	dc.w	762,6,763,6,764,6,765,60,SPFfallfwd+19,8,SPFduck+4,-8
.6
.7	dc.w	766,6,767,6,768,6,769,60,SPFfallback+27,8,SPFduck+6,-8

SPAboardback	=	*-SPAlist		;Checked into the end boards behind the bottom goal line
									;(FallDown.FallList 2)
SPAboardback_table:					;Frames 292-785
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0
.1	dc.w	770,6,771,6,772,6,773,60,SPFfallfwd+3,8,SPFduck,-8
.2
;RAM xref
.3	dc.w	774,6,775,6,776,6,777,60,SPFfallfwd+11,8,SPFduck+2,-8
.4
.5	dc.w	778,6,779,6,780,6,781,60,SPFfallback+19,8,SPFduck+4,-8
.6
.7	dc.w	782,6,783,6,784,6,785,60,SPFfallfwd+27,8,SPFduck+6,-8

SPAboardleft	=	*-SPAlist		;Checked into the left side boards (FallDown.FallList 3; flipped
									;sprites swap it with SPAboardright)
SPAboardleft_table:					;Frames 284-801
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0
.1	dc.w	786,6,787,6,788,6,789,60,SPFfallfwd+3,8,SPFduck,-8
.2
.3	dc.w	790,6,791,6,792,6,793,60,SPFfallback+11,8,SPFduck+2,-8
.4
.5	dc.w	794,6,795,6,796,6,797,60,SPFfallfwd+19,8,SPFduck+4,-8
.6
.7	dc.w	798,6,799,6,800,6,801,60,SPFfallback+27,8,SPFduck+6,-8

SPAbenchcheckl	=	*-SPAlist		;Checked into the left boards near center ice (FallDown, from
									;SPAboardleft / SPAboardright by Ypos and flip)
SPAbenchcheckl_table:				;Frames 284-815
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	802,6,803,6,804,6,805,6,806,6,807,6,808,6,800,6
	dc.w	769,6,SPFfallback+27,80,SPFduck+6,-8
.1
.2
.3	dc.w	790,6,809,6,810,6,811,6,812,6,813,6,809,6,792,6
	dc.w	761,6,SPFfallback+11,80,SPFduck+2,-8
.4	dc.w	814,6,815,6,804,6,805,6,806,6,807,6,808,6,800,6
	dc.w	769,6,SPFfallback+27,80,SPFduck+6,-8
.5
.6
.7	dc.w	798,6,815,6,804,6,805,6,806,6,807,6,808,6,800,6
	dc.w	769,6,SPFfallback+27,80,SPFduck+6,-8

SPAbenchcheckr	=	*-SPAlist		;Checked into the right boards near center ice (FallDown, from
									;SPAboardleft / SPAboardright by Ypos and flip)
SPAbenchcheckr_table:				;Frames 284-829
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	816,6,817,6,818,6,819,6,820,6,821,6,822,6,792,6
	dc.w	761,6,SPFfallback+11,80,SPFduck+2,-8
.1
.2
.3	dc.w	758,6,823,6,818,6,819,6,820,6,821,6,822,6,792,6
	dc.w	761,6,SPFfallback+11,80,SPFduck+2,-8
.4	dc.w	824,6,823,6,818,6,819,6,820,6,821,6,822,6,792,6
	dc.w	761,6,SPFfallback+11,80,SPFduck+2,-8
.5
.6
.7	dc.w	766,6,825,6,826,6,827,6,828,6,829,6,825,6,800,6
	dc.w	769,6,SPFfallback+27,80,SPFduck+6,-8

SPAcrosscheck	=	*-SPAlist		;The checker stops after a hit into the boards away from the crease
									;(FallDown sets it on a3)
SPAcrosscheck_table:				;Frames 830-837
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	830,-24
.1	dc.w	831,-24
.2	dc.w	832,-24
.3	dc.w	833,-24
.4	dc.w	834,-24
.5	dc.w	835,-24
.6	dc.w	836,-24
.7	dc.w	837,-24

SPAinjury1	=	*-SPAlist			;player falls and lies injured
SPAinjury1_table:					;last table (93 had it right after flip)
.t									;offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0
.1
.2
.7	dc.w	SPFfallback,6,SPFfallback+1,6,SPFfallback+2,30,SPFinjury1,10,SPFinjury1+1,10,SPFinjury1+2,10,SPFinjury1+3,8,SPFinjury1+4,8
	dc.w	SPFinjury1+5,8,SPFinjury1+3,8,SPFinjury1+4,8,SPFinjury1+5,8,SPFinjury1+3,8,SPFinjury1+4,8,SPFinjury1+5,8,SPFinjury1+3,8
	dc.w	SPFinjury1+4,8,SPFinjury1+5,-900
.3
.4
.5
.6	dc.w	SPFfallback+16,6,SPFfallback+17,6,SPFfallback+18,30,SPFinjury1+6,10,SPFinjury1+7,10,SPFinjury1+8,10,SPFinjury1+9,8,SPFinjury1+10,8
	dc.w	SPFinjury1+11,8,SPFinjury1+9,8,SPFinjury1+10,8,SPFinjury1+11,8,SPFinjury1+9,8,SPFinjury1+10,8,SPFinjury1+11,8,SPFinjury1+9,8
	dc.w	SPFinjury1+10,8,SPFinjury1+11,-900

; End of animation list
