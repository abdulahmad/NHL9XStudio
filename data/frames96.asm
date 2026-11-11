;	Sprite animation tables. For every animation there is a table that gives the frames to show
;	in each direction and how long to show each one. A player's SPA is the offset of the player's
;	table from SPAlist.

;	Table: 8 words, the offset of each direction's frame,time pairs (0-7), then the attribute word
;	(bit 0: start again at the end; clear, the animation stops). A negative time marks the last
;	pair; pairs after it are marked "past the end".
;
;	Tables not named yet carry their SPA value in the name until the code that uses them is converted.

SPAlist								;The animation tables: the animation code adds SPA to it
	dc.w	0

SPA0002	=	*-SPAlist
SPA0002_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1,5,2,5,1,-10
.1	dc.w	3,5,4,5,3,-10
.2	dc.w	5,5,6,5,5,-10
.3	dc.w	7,5,8,5,7,-10
.4	dc.w	9,5,10,5,9,-10
.5	dc.w	11,5,12,5,11,-10
.6	dc.w	13,5,14,5,13,-10
.7	dc.w	15,5,16,5,15,-10

SPA0074	=	*-SPAlist
SPA0074_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	17,2,18,30,37,-4
.1	dc.w	19,2,20,30,38,-4
.2	dc.w	21,2,22,30,39,-4
.4	dc.w	23,2,24,30,40,-4
.5	dc.w	25,2,26,30,41,-4
.6	dc.w	27,2,28,30,42,-4

SPA00CE	=	*-SPAlist
SPA00CE_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	29,-16
.2	dc.w	30,-16
.6	dc.w	29,-16

SPA00EC	=	*-SPAlist
SPA00EC_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	43,5,44,5,45,5,46,-5
.2	dc.w	47,5,48,5,49,5,50,-5
.6	dc.w	43,5,44,5,45,5,46,-5

SPAgglover	=	*-SPAlist
SPAgglover_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	51,2,52,-30
.1	dc.w	53,2,54,-30
.2	dc.w	55,2,56,-30
.4	dc.w	57,2,58,-30
.5	dc.w	59,2,60,-30
.6	dc.w	61,2,62,-30

SPA0170	=	*-SPAlist
SPA0170_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	63,2,64,30,31,-4
.1	dc.w	65,2,66,30,32,-4
.2	dc.w	67,2,68,30,33,-4
.4	dc.w	69,2,70,30,34,-4
.5	dc.w	71,2,72,30,35,-4
.6	dc.w	73,2,74,30,36,-4

SPAgglovel	=	*-SPAlist
SPAgglovel_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	75,2,76,-30
.1	dc.w	77,2,78,-30
.2	dc.w	79,2,80,-30
.4	dc.w	81,2,82,-30
.5	dc.w	83,2,84,-30
.6	dc.w	85,2,86,-30

SPAgstickl	=	*-SPAlist
SPAgstickl_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	87,2,88,30,31,-4
.1	dc.w	89,2,90,30,32,-4
.2	dc.w	91,2,92,30,33,-4
.4	dc.w	93,2,94,30,34,-4
.5	dc.w	95,2,96,30,35,-4
.6	dc.w	97,2,98,30,36,-4

SPAgstickr	=	*-SPAlist
SPAgstickr_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	99,2,100,30,37,-4
.1	dc.w	101,2,102,30,38,-4
.2	dc.w	103,2,104,30,39,-4
.4	dc.w	105,2,106,30,40,-4
.5	dc.w	107,2,108,30,41,-4
.6	dc.w	109,2,110,30,42,-4

SPA02C0	=	*-SPAlist
SPA02C0_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	111,2,112,30,31,-4
.1	dc.w	113,2,114,30,32,-4
.2	dc.w	115,2,116,30,33,-4
.4	dc.w	117,2,118,30,34,-4
.5	dc.w	119,2,120,30,35,-4
.6	dc.w	121,2,122,30,36,-4

SPA031A	=	*-SPAlist
SPA031A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	123,-15
.1	dc.w	124,-15
.2	dc.w	125,-15
.4	dc.w	126,-15
.5	dc.w	127,-15
.6	dc.w	128,-15

SPA0344	=	*-SPAlist
SPA0344_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	129,4,130,4,131,-30
.2	dc.w	132,4,133,4,134,-30
.6	dc.w	129,4,130,4,131,-30

SPA037A	=	*-SPAlist
SPA037A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	1

.0	dc.w	135,5,136,5,137,10,138,-5
.2	dc.w	139,5,140,5,141,10,142,-5
.6	dc.w	135,5,136,5,137,10,138,-5

SPA03BC	=	*-SPAlist
SPA03BC_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	143,5,144,-5
.2	dc.w	145,5,146,-5
.6	dc.w	143,5,144,-5

SPAgstackl	=	*-SPAlist
SPAgstackl_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	147,4,148,30,31,-4
.1	dc.w	149,4,150,30,32,-4
.2	dc.w	151,4,152,30,33,-4
.4	dc.w	153,4,154,30,34,-4
.5	dc.w	155,4,156,30,35,-4
.6	dc.w	157,4,158,30,36,-4

SPAgstackr	=	*-SPAlist
SPAgstackr_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	159,4,160,30,37,-4
.1	dc.w	161,4,162,30,38,-4
.2	dc.w	163,4,164,30,39,-4
.4	dc.w	165,4,166,30,40,-4
.5	dc.w	167,4,168,30,41,-4
.6	dc.w	169,4,170,30,42,-4

SPAgdive	=	*-SPAlist
SPAgdive_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	171,5,172,5,173,5,174,-30
.1	dc.w	175,5,176,5,177,5,178,-30
.2	dc.w	179,5,180,5,181,5,182,-30
.3	dc.w	183,5,184,5,185,5,186,-30
.4	dc.w	187,5,188,5,189,5,190,-30
.5	dc.w	191,5,192,5,193,5,194,-30
.6	dc.w	195,5,196,5,197,5,198,-30
.7	dc.w	199,5,200,5,201,5,202,-30

SPA052C	=	*-SPAlist
SPA052C_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	204,4,205,-4
.1	dc.w	208,4,209,-4
.2	dc.w	212,4,213,-4
.3	dc.w	216,4,217,-4
.4	dc.w	220,4,221,-4
.5	dc.w	224,4,225,-4
.6	dc.w	228,4,229,-4
.7	dc.w	232,4,233,-4

SPA057E	=	*-SPAlist
SPA057E_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	235,-30
.1	dc.w	236,-30
.2	dc.w	237,-30
.3	dc.w	238,-30
.4	dc.w	239,-30
.5	dc.w	240,-30
.6	dc.w	241,-30
.7	dc.w	242,-30

SPA05B0	=	*-SPAlist
SPA05B0_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	243,5,244,5,245,5,246,-5
.2	dc.w	247,5,248,5,249,5,250,-5
.6	dc.w	243,5,244,5,245,5,246,-5

SPA05F2	=	*-SPAlist
SPA05F2_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	253,5,254,10,251,-5
.1	dc.w	255,5,256,10,257,-5
.2	dc.w	261,5,261,10,261,-5
.5	dc.w	263,5,264,10,263,-5
.6	dc.w	263,5,264,10,263,-5

SPA0640	=	*-SPAlist
SPA0640_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	259,7,260,7,261,7,262,7,263,7,264,-7
.1	dc.w	265,7,266,7,267,7,268,7,269,7,270,-7
.2	dc.w	271,7,272,7,273,7,274,7,275,7,276,-7
.3	dc.w	277,7,278,7,279,7,280,7,281,7,282,-7
.4	dc.w	283,7,284,7,285,7,286,7,287,7,288,-7
.5	dc.w	289,7,290,7,291,7,292,7,293,7,294,-7
.6	dc.w	295,7,296,7,297,7,298,7,299,7,300,-7
.7	dc.w	301,7,302,7,303,7,304,7,305,7,306,-7

SPA0712	=	*-SPAlist
SPA0712_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	355,-10
.1	dc.w	356,-10
.2	dc.w	357,-10
.3	dc.w	358,-10
.4	dc.w	359,-10
.5	dc.w	360,-10
.6	dc.w	361,-10
.7	dc.w	362,-10

SPA0744	=	*-SPAlist
SPA0744_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	363,8,364,8,365,8,366,8,367,8,368,8,369,8,370,-8
.1	dc.w	371,8,372,8,373,8,374,8,375,8,376,8,377,8,378,-8
.2	dc.w	379,8,380,8,381,8,382,8,383,8,384,8,385,8,386,-8
.3	dc.w	387,8,388,8,389,8,390,8,391,8,392,8,393,8,394,-8
.4	dc.w	395,8,396,8,397,8,398,8,399,8,400,8,401,8,402,-8
.5	dc.w	403,8,404,8,405,8,406,8,407,8,408,8,409,8,410,-8
.6	dc.w	411,8,412,8,413,8,414,8,415,8,416,8,417,8,418,-8
.7	dc.w	419,8,420,8,421,8,422,8,423,8,424,8,425,8,426,-8

SPA0856	=	*-SPAlist
SPA0856_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	427,-8
.1	dc.w	428,-8
.2	dc.w	429,-8
.3	dc.w	430,-8
.4	dc.w	431,-8
.5	dc.w	432,-8
.6	dc.w	433,-8
.7	dc.w	434,-8

SPA0888	=	*-SPAlist
SPA0888_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	435,5,436,5,437,5,438,5,439,5,440,5,441,5,442,-5
.1	dc.w	443,5,444,5,445,5,446,5,447,5,448,5,449,5,450,-5
.2	dc.w	451,5,452,5,453,5,454,5,455,5,456,5,457,5,458,-5
.3	dc.w	459,5,460,5,461,5,462,5,463,5,464,5,465,5,466,-5
.4	dc.w	467,5,468,5,469,5,470,5,471,5,472,5,473,5,474,-5
.5	dc.w	475,5,476,5,477,5,478,5,479,5,480,5,481,5,482,-5
.6	dc.w	483,5,484,5,485,5,486,5,487,5,488,5,489,5,490,-5
.7	dc.w	491,5,492,5,493,5,494,5,495,5,496,5,497,5,498,-5

SPA099A	=	*-SPAlist
SPA099A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	499,5,500,5,501,5,502,40,1049,6,1050,6,1051,6,1052,-6
.1	dc.w	503,5,504,5,505,5,506,40,1037,6,1038,6,1039,6,1040,6
	dc.w	1041,-6
.2	dc.w	507,5,508,5,509,5,510,40,1041,6,1042,6,1043,6,1044,-6
.4	dc.w	511,5,512,5,513,5,514,40,1041,6,1042,6,1043,6,1044,-6
.5	dc.w	515,5,516,5,517,5,518,40,1045,6,1046,6,1047,6,1048,-6
.6	dc.w	519,5,520,5,521,5,522,40,1049,6,1050,6,1051,6,1052,-6

SPA0A70	=	*-SPAlist
SPA0A70_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	523,-5
.1	dc.w	524,-5
.2	dc.w	525,-5
.3	dc.w	526,-5
.4	dc.w	527,-5
.5	dc.w	528,-5
.6	dc.w	529,-5
.7	dc.w	530,-5

SPA0AA2	=	*-SPAlist
SPA0AA2_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	531,4,532,4,533,4,534,4,535,4,536,4,537,4,538,4
	dc.w	539,4,540,4,541,4,542,4,543,4,544,4,545,4,546,-4

SPA0AF4	=	*-SPAlist
SPA0AF4_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	546,8,545,8,544,8,543,8,430,-2

SPA0B1A	=	*-SPAlist
SPA0B1A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	547,2,548,-2
.1	dc.w	549,2,550,-2
.2	dc.w	551,2,552,-2
.3	dc.w	553,2,554,-2
.4	dc.w	555,2,556,-2
.5	dc.w	557,2,558,-2
.6	dc.w	559,2,560,-2
.7	dc.w	561,2,562,-2

SPA0B6C	=	*-SPAlist
SPA0B6C_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	563,2,564,-2
.1	dc.w	565,2,566,-2
.2	dc.w	567,2,568,-2
.3	dc.w	569,2,570,-2
.4	dc.w	571,2,572,-2
.5	dc.w	573,2,574,-2
.6	dc.w	575,2,576,-2
.7	dc.w	577,2,578,-2

SPA0BBE	=	*-SPAlist
SPA0BBE_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.5-.t
	dc.w	.5-.t
	dc.w	.5-.t
	dc.w	0

.0	dc.w	579,7,580,7,579,7,580,7,579,7,580,-7
.1	dc.w	581,7,582,7,581,7,582,7,581,7,582,-7
.3	dc.w	583,7,584,7,583,7,584,7,583,7,584,-7
.5	dc.w	585,7,586,7,585,7,586,7,585,7,586,-7

SPA0C30	=	*-SPAlist
SPA0C30_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	590,6,587,3,588,3,589,6,588,3,587,3,588,3,589,6
	dc.w	588,3,587,3,588,3,589,6,588,3,589,6,590,-3

SPA0C7E	=	*-SPAlist
SPA0C7E_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	598,4,597,4,596,4,593,-8

SPA0CA0	=	*-SPAlist
SPA0CA0_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	598,4,597,4,596,4,591,4,592,4,593,4,596,4,597,4
	dc.w	598,4,596,591,593,4,594,4,595,4,594,4,593,4,594,4
	dc.w	595,4,594,4,593,4,594,4,595,4,594,4,596,-4

SPA0D0E	=	*-SPAlist
SPA0D0E_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	599,4,602,-10

SPA0D28	=	*-SPAlist
SPA0D28_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	599,4,600,4,601,4,602,4,603,4,604,4,603,4,602,4
	dc.w	603,4,604,4,603,4,602,4,603,4,604,4,603,4,599,-4

SPA0D7A	=	*-SPAlist
SPA0D7A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	605,8,606,8,607,8,608,8,609,8,610,-8
.3	dc.w	610,8,609,8,608,8,607,8,606,8,605,-8

SPA0DBC	=	*-SPAlist
SPA0DBC_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	610,8,609,8,608,8,607,8,606,8,605,-8
.3	dc.w	605,8,606,8,607,8,608,8,609,8,610,-8

SPA0DFE	=	*-SPAlist
SPA0DFE_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	611,8,612,8,613,8,614,8,615,8,616,-8
.3	dc.w	616,8,615,8,614,8,613,8,612,8,611,-8

SPA0E40	=	*-SPAlist
SPA0E40_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	616,8,615,8,614,8,613,8,612,8,611,-8
.3	dc.w	611,8,612,8,613,8,614,8,615,8,616,-8

SPA0E82	=	*-SPAlist
SPA0E82_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	617,2,618,2,619,2,620,-2
.1	dc.w	621,2,622,2,623,2,624,-2
.2	dc.w	625,2,626,2,627,2,628,-2
.3	dc.w	629,2,630,2,631,2,632,-2
.4	dc.w	633,2,634,2,635,2,636,-2
.5	dc.w	637,2,638,2,639,2,640,-2
.6	dc.w	641,2,642,2,643,2,644,-2
.7	dc.w	645,2,646,2,647,2,648,-2

SPA0F14	=	*-SPAlist
SPA0F14_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	1029,4,1030,4,1031,4,1032,4,1033,4,1034,4,1035,4,1036,50
	dc.w	1049,6,1050,6,1051,6,1052,-6
.2	dc.w	649,4,650,4,651,4,652,4,653,4,654,4,655,4,656,50
	dc.w	1041,6,1042,6,1043,6,1044,-6
.6	dc.w	1029,4,1030,4,1031,4,1032,4,1033,4,1034,4,1035,4,1036,50
	dc.w	1049,6,1050,6,1051,6,1052,-6

SPA0FB6	=	*-SPAlist
SPA0FB6_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	683,4,682,4,681,4,681,4,681,4,682,4,683,4,684,4
	dc.w	684,-20
.1	dc.w	687,4,686,4,685,4,685,4,685,4,686,4,687,4,688,4
	dc.w	688,-20
.2	dc.w	1678,4,1677,4,1676,4,1676,4,1676,4,1677,4,1678,4,1679,4
	dc.w	1679,-20
.3	dc.w	691,4,690,4,689,4,689,4,689,4,690,4,691,4,692,4
	dc.w	692,-20
.4	dc.w	695,4,694,4,693,4,693,4,693,4,694,4,695,4,696,4
	dc.w	696,-20
.5	dc.w	699,4,698,4,697,4,697,4,697,4,698,4,699,4,700,4
	dc.w	700,-20
.6	dc.w	703,4,702,4,701,4,701,4,701,4,702,4,703,4,704,4
	dc.w	704,-20
.7	dc.w	707,4,706,4,705,4,705,4,705,4,706,4,707,4,708,4
	dc.w	708,-20

SPA10E8	=	*-SPAlist
SPA10E8_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	709,1,710,1,711,1,712,1,713,3,714,-1
.1	dc.w	715,1,716,1,717,1,718,1,719,3,720,-1
.2	dc.w	721,1,722,1,723,1,724,1,725,3,726,-1
.3	dc.w	727,1,728,1,729,1,730,1,731,3,732,-1
.4	dc.w	733,1,734,1,735,1,736,1,737,3,738,-1
.5	dc.w	739,1,740,1,741,1,742,1,743,3,744,-1
.6	dc.w	745,1,746,1,747,1,748,1,749,3,750,-1
.7	dc.w	751,1,752,1,753,1,754,1,755,3,756,-1

SPA11BA	=	*-SPAlist
SPA11BA_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	760,3,759,3,758,3,757,3,758,3,759,3,760,3,761,3
	dc.w	762,-15
.1	dc.w	766,3,765,3,764,3,763,3,764,3,765,3,766,3,767,3
	dc.w	768,-15
.2	dc.w	772,3,771,3,770,3,769,3,770,3,771,3,772,3,773,3
	dc.w	774,-15
.3	dc.w	778,3,777,3,776,3,775,3,776,3,777,3,778,3,779,3
	dc.w	780,-15
.4	dc.w	784,3,783,3,782,3,781,3,782,3,783,3,784,3,785,3
	dc.w	786,-15
.5	dc.w	790,3,789,3,788,3,787,3,788,3,789,3,790,3,791,3
	dc.w	792,-15
.6	dc.w	796,3,795,3,794,3,793,3,794,3,795,3,796,3,797,3
	dc.w	798,-15
.7	dc.w	802,3,801,3,800,3,799,3,800,3,801,3,802,3,803,3
	dc.w	804,-15

SPA12EC	=	*-SPAlist
SPA12EC_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	853,4,854,4,855,4,856,4,855,-4
.1	dc.w	857,4,858,4,859,4,860,4,859,-4
.2	dc.w	861,4,862,4,863,4,864,4,863,-4
.3	dc.w	865,4,866,4,867,4,868,4,867,-4
.4	dc.w	869,4,870,4,871,4,872,4,871,-4
.5	dc.w	873,4,874,4,875,4,876,4,875,-4
.6	dc.w	877,4,878,4,879,4,880,4,879,-4
.7	dc.w	881,4,882,4,883,4,884,4,883,-4

SPA139E	=	*-SPAlist
SPA139E_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	885,20,886,-20
.1	dc.w	887,20,888,-20
.2	dc.w	889,20,890,-20
.3	dc.w	891,20,892,-20
.4	dc.w	893,20,894,-20
.5	dc.w	895,20,896,-20
.6	dc.w	897,20,898,-20
.7	dc.w	899,20,900,-20

SPA13F0	=	*-SPAlist
SPA13F0_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	901,20,902,-20
.1	dc.w	903,20,904,-20
.2	dc.w	905,20,906,-20
.3	dc.w	907,20,908,-20
.4	dc.w	909,20,910,-20
.5	dc.w	911,20,912,-20
.6	dc.w	913,20,914,-20
.7	dc.w	915,20,916,-20

SPA1442	=	*-SPAlist
SPA1442_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	917,6,918,-6
.1	dc.w	919,6,920,-6
.2	dc.w	921,6,922,-6
.3	dc.w	923,6,924,-6
.4	dc.w	925,6,926,-6
.5	dc.w	927,6,928,-6
.6	dc.w	929,6,930,-6
.7	dc.w	931,6,932,-6

SPA1494	=	*-SPAlist
SPA1494_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	933,2,934,6,935,4,936,-2
.1	dc.w	937,2,938,6,939,4,940,-2
.2	dc.w	941,2,942,6,943,4,944,-2
.3	dc.w	945,2,946,6,947,4,948,-2
.4	dc.w	949,2,950,6,951,4,952,-2
.5	dc.w	953,2,954,6,955,4,956,-2
.6	dc.w	957,2,958,6,959,4,960,-2
.7	dc.w	961,2,962,6,963,4,964,-2

SPA1526	=	*-SPAlist
SPA1526_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	997,2,998,6,999,4,1000,-2
.1	dc.w	1001,2,1002,6,1003,4,1004,-2
.2	dc.w	1005,2,1006,6,1007,4,1008,-2
.3	dc.w	1009,2,1010,6,1011,4,1012,-2
.4	dc.w	1013,2,1014,6,1015,4,1016,-2
.5	dc.w	1017,2,1018,6,1019,4,1020,-2
.6	dc.w	1021,2,1022,6,1023,4,1024,-2
.7	dc.w	1025,2,1026,6,1027,4,1028,-2

SPA15B8	=	*-SPAlist
SPA15B8_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	965,2,966,2,967,4,968,-2
.1	dc.w	969,2,970,2,971,4,972,-2
.2	dc.w	973,2,974,2,975,4,976,-2
.3	dc.w	977,2,978,2,979,4,980,-2
.4	dc.w	981,2,982,2,983,4,984,-2
.5	dc.w	985,2,986,2,987,4,988,-2
.6	dc.w	989,2,990,2,991,4,992,-2
.7	dc.w	993,2,994,2,995,4,996,-2

SPA164A	=	*-SPAlist
SPA164A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1053,10,1054,-10
.1	dc.w	1055,10,1056,-10
.2	dc.w	1057,10,1058,-10
.3	dc.w	1059,10,1060,-10
.4	dc.w	1061,10,1062,-10
.5	dc.w	1063,10,1064,-10
.6	dc.w	1065,10,1066,-10
.7	dc.w	1067,10,1068,-10

SPAHold	=	*-SPAlist
SPAHold_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1053,13,1054,-13
.1	dc.w	1055,13,1056,-13
.2	dc.w	1057,13,1058,-13
.3	dc.w	1059,13,1060,-13
.4	dc.w	1061,13,1062,-13
.5	dc.w	1063,13,1064,-13
.6	dc.w	1065,13,1066,-13
.7	dc.w	1067,13,1068,-13

SPA16EE	=	*-SPAlist
SPA16EE_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1053,13,1054,-13
.1	dc.w	1055,13,1056,-13
.2	dc.w	1057,13,1058,-13
.3	dc.w	1059,13,1060,-13
.4	dc.w	1061,13,1062,-13
.5	dc.w	1063,13,1064,-13
.6	dc.w	1065,13,1066,-13
.7	dc.w	1067,13,1068,-13

SPA1740	=	*-SPAlist
SPA1740_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1069,10,1070,-10
.1	dc.w	1071,10,1072,-10
.2	dc.w	1073,10,1074,-10
.3	dc.w	1075,10,1076,-10
.4	dc.w	1077,10,1078,-10
.5	dc.w	1079,10,1080,-10
.6	dc.w	1081,10,1082,-10
.7	dc.w	1083,10,1084,-10

SPAhook	=	*-SPAlist
SPAhook_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1069,8,1070,-22
.1	dc.w	1071,8,1072,-22
.2	dc.w	1073,8,1074,-22
.3	dc.w	1075,8,1076,-22
.4	dc.w	1077,8,1078,-22
.5	dc.w	1079,8,1080,-22
.6	dc.w	1081,8,1082,-22
.7	dc.w	1083,8,1084,-22

SPA17E4	=	*-SPAlist
SPA17E4_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	0

.0	dc.w	1375,4,1376,4,1377,4,1378,4,1379,4,1380,10,1085,4,1086,4
	dc.w	1087,4,1088,16,1087,4,1086,4,1085,10,1086,4,1087,4,1088,4
	dc.w	1087,4,1086,4,1085,-1024
.4	dc.w	1363,4,1364,4,1365,4,1366,4,1367,4,1368,10,1766,4,1767,4
	dc.w	1768,4,1769,16,1768,4,1767,4,1766,10,1767,4,1768,4,1769,4
	dc.w	1768,4,1767,4,1766,-1024

SPA188E	=	*-SPAlist
SPA188E_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	0

.0	dc.w	1375,4,1376,4,1377,4,1378,4,1379,4,1380,10,1093,20,1094,4
	dc.w	1095,4,1096,12,1095,4,1094,4,1093,20,1094,4,1095,4,1096,12
	dc.w	1095,4,1094,20,1093,20,1094,4,1095,4,1096,12,1095,4,1094,4
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,20,1093,20,1094,4
	dc.w	1095,4,1096,12,1095,4,1094,4,1093,20,1094,4,1095,4,1096,12
	dc.w	1095,4,1094,20,1093,20,1094,4,1095,4,1096,12,1095,4,1094,4
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,20,1093,20,1094,4
	dc.w	1095,4,1096,12,1095,4,1094,4,1093,20,1094,4,1095,4,1096,12
	dc.w	1095,4,1094,20,1093,20,1094,4,1095,4,1096,12,1095,4,1094,4
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,20,1093,20,1094,4
	dc.w	1095,4,1096,12,1095,4,1094,4,1093,20,1094,4,1095,4,1096,12
	dc.w	1095,4,1094,20,1093,20,1094,4,1095,4,1096,12,1095,4,1094,4
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,20,1093,20,1094,4
	dc.w	1095,4,1096,12,1095,4,1094,4,1093,20,1094,4,1095,4,1096,12
	dc.w	1095,4,1094,20,1093,20,1094,4,1095,4,1096,12,1095,4,1094,4
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,-20
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,4,1093,20,1094,4	;past the end
	dc.w	1095,4,1096,12,1095,4,1094,-20	;past the end
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,4,1093,20,1094,4	;past the end
	dc.w	1095,4,1096,12,1095,4,1094,-20	;past the end
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,4,1093,20,1094,4	;past the end
	dc.w	1095,4,1096,12,1095,4,1094,-20	;past the end
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,4,1093,20,1094,4	;past the end
	dc.w	1095,4,1096,12,1095,4,1094,-20	;past the end
	dc.w	1093,20,1094,4,1095,4,1096,12,1095,4,1094,4,1093,20,1094,4	;past the end
	dc.w	1095,4,1096,12,1095,4,1094,-20	;past the end
.4	dc.w	1363,4,1364,4,1365,4,1366,4,1367,4,1368,10,1774,20,1775,4
	dc.w	1776,4,1777,12,1776,4,1775,4,1774,20,1775,4,1776,4,1777,12
	dc.w	1776,4,1775,4,1774,20,1774,20,1775,4,1776,4,1777,12,1776,4
	dc.w	1775,4,1774,20,1775,4,1776,4,1777,12,1776,4,1775,4,1774,20
	dc.w	1774,20,1775,4,1776,4,1777,12,1776,4,1775,4,1774,20,1775,4
	dc.w	1776,4,1777,12,1776,4,1775,4,1774,20,1774,20,1775,4,1776,4
	dc.w	1777,12,1776,4,1775,4,1774,20,1775,4,1776,4,1777,12,1776,4
	dc.w	1775,4,1774,20,1774,20,1775,4,1776,4,1777,12,1776,4,1775,4
	dc.w	1774,20,1775,4,1776,4,1777,12,1776,4,1775,4,1774,20,1774,20
	dc.w	1775,4,1776,4,1777,12,1776,4,1775,4,1774,20,1775,4,1776,4
	dc.w	1777,12,1776,4,1775,4,1774,20,1774,20,1775,4,1776,4,1777,12
	dc.w	1776,4,1775,4,1774,20,1775,4,1776,4,1777,12,1776,4,1775,4
	dc.w	1774,20,1774,20,1775,4,1776,4,1777,12,1776,4,1775,4,1774,20
	dc.w	1775,4,1776,4,1777,12,1776,4,1775,4,1774,20,1774,20,1775,4
	dc.w	1776,4,1777,12,1776,4,1775,4,1774,20,1775,4,1776,4,1777,12
	dc.w	1776,4,1775,4,1774,20,1774,20,1775,4,1776,4,1777,12,1776,4
	dc.w	1775,4,1774,20,1775,4,1776,4,1777,12,1776,4,1775,4,1774,20
	dc.w	1774,20,1775,4,1776,4,1777,12,1776,4,1775,4,1774,20,1775,4
	dc.w	1776,4,1777,12,1776,4,1775,4,1774,20,1774,20,1775,4,1776,4
	dc.w	1777,12,1776,4,1775,4,1774,20,1775,4,1776,4,1777,12,1776,4
	dc.w	1775,4,1774,20,1774,20,1775,4,1776,4,1777,12,1776,4,1775,4
	dc.w	1774,20,1775,4,1776,4,1777,12,1776,4,1775,4,1774,20,1774,20
	dc.w	1775,4,1776,4,1777,12,1776,4,1775,4,1774,20,1775,4,1776,4
	dc.w	1777,12,1776,4,1775,4,1774,20,1774,20,1775,4,1776,4,1777,12
	dc.w	1776,4,1775,4,1774,20,1775,4,1776,4,1777,12,1776,4,1775,4
	dc.w	1774,-20

SPA1EAC	=	*-SPAlist
SPA1EAC_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	0

.0	dc.w	1375,4,1376,4,1377,4,1378,4,1379,4,1380,10,1089,12,1090,4
	dc.w	1091,4,1092,8,1091,4,1090,4,1089,20,1090,4,1091,4,1092,-1024
.4	dc.w	1363,4,1364,4,1365,4,1366,4,1367,4,1368,10,1770,12,1771,4
	dc.w	1772,4,1773,8,1772,4,1771,4,1770,20,1771,4,1772,4,1773,12
	dc.w	1772,4,1771,4,1770,12,1771,4,1772,4,1773,8,1772,4,1771,4
	dc.w	1770,20,1771,4,1772,4,1773,12,1772,4,1771,-1024

SPA1F76	=	*-SPAlist
SPA1F76_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	0

.0	dc.w	1375,4,1376,4,1377,4,1378,4,1379,4,1380,10,1097,16,1098,4
	dc.w	1099,4,1100,20,1099,4,1098,4,1097,4,1098,4,1099,4,1100,20
	dc.w	1099,4,1098,4,1097,-1024
.4	dc.w	1363,4,1364,4,1365,4,1366,4,1367,4,1368,10,1778,20,1779,4
	dc.w	1780,4,1781,24,1780,4,1779,4,1778,4,1779,4,1780,4,1781,24
	dc.w	1780,4,1779,4,1778,-1024

SPA2020	=	*-SPAlist
SPA2020_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1101,-8
.1	dc.w	1102,-8
.2	dc.w	1103,-8
.3	dc.w	1104,-8
.4	dc.w	1105,-8
.5	dc.w	1106,-8
.6	dc.w	1107,-8
.7	dc.w	1108,-8

SPA2052	=	*-SPAlist
SPA2052_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1109,-8
.1	dc.w	1110,-8
.2	dc.w	1111,-8
.3	dc.w	1112,-8
.4	dc.w	1113,-8
.5	dc.w	1114,-8
.6	dc.w	1115,-8
.7	dc.w	1116,-8

SPAboardmidl	=	*-SPAlist
SPAboardmidl_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	1117,4,1118,4,1119,4,1120,4,1121,4,1122,30,610,8,609,8
	dc.w	608,8,607,8,606,8,605,-8
.3	dc.w	1123,4,1124,4,1125,4,1126,4,1127,4,1128,30,605,8,606,8
	dc.w	607,8,608,8,609,8,610,-8
.6	dc.w	1117,4,1118,4,1119,4,1120,4,1121,4,1122,30,610,8,609,8
	dc.w	608,8,607,8,606,8,605,-8

SPA2126	=	*-SPAlist
SPA2126_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	0

.0	dc.w	1133,1,1134,10,1135,-6
.1	dc.w	1129,1,1130,10,1131,-6

SPA2150	=	*-SPAlist
SPA2150_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	0

.0	dc.w	1133,-2
.1	dc.w	1129,-2

SPA216A	=	*-SPAlist
SPA216A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1137,4,1138,4,1139,4,1140,4,1137,-4
.1	dc.w	1141,4,1142,4,1143,4,1144,4,1141,-4
.2	dc.w	1145,4,1146,4,1147,4,1148,4,1145,-4
.3	dc.w	1149,4,1150,4,1151,4,1152,4,1149,-4
.4	dc.w	1153,4,1154,4,1155,4,1156,4,1153,-4
.5	dc.w	1157,4,1158,4,1159,4,1160,4,1157,-4
.6	dc.w	1161,4,1162,4,1163,4,1164,4,1161,-4
.7	dc.w	1165,4,1166,4,1167,4,1168,4,1165,-4

SPA221C	=	*-SPAlist
SPA221C_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1169,4,1170,4,1171,4,1172,-4
.1	dc.w	1173,4,1174,4,1175,4,1176,-4
.2	dc.w	1177,4,1178,4,1179,4,1180,-4
.3	dc.w	1181,4,1182,4,1183,4,1184,-4
.4	dc.w	1185,4,1186,4,1187,4,1188,-4
.5	dc.w	1189,4,1190,4,1191,4,1192,-4
.6	dc.w	1193,4,1194,4,1195,4,1196,-4
.7	dc.w	1197,4,1198,4,1199,4,1200,-4

SPAboardtop	=	*-SPAlist
SPAboardtop_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	1201,4,1202,4,1203,4,1204,4,1205,4,1206,20,1045,4,1046,4
	dc.w	1047,4,1048,-4
.2	dc.w	1207,4,1208,4,1209,4,1210,4,1211,4,1212,20,1041,4,1042,4
	dc.w	1043,4,1044,-4
.4	dc.w	1213,4,1214,4,1215,4,1216,4,1217,4,1218,20,1037,4,1038,4
	dc.w	1039,4,1040,-4
.6	dc.w	1219,4,1220,4,1221,4,1222,4,1223,4,1224,20,1041,4,1042,4
	dc.w	1043,4,1044,-4

SPAboardleft	=	*-SPAlist
SPAboardleft_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	1225,4,1226,4,1227,4,1228,4,1229,4,1230,20,1045,4,1046,4
	dc.w	1047,4,1048,-4
.2	dc.w	1231,4,1232,4,1233,4,1234,4,1235,4,1236,20,1049,4,1050,4
	dc.w	1051,4,1052,-4
.4	dc.w	1237,4,1238,4,1239,4,1240,4,1241,4,1242,20,1045,4,1046,4
	dc.w	1047,4,1048,-4
.6	dc.w	1243,4,1244,4,1245,4,1246,4,1247,4,1248,20,1041,4,1042,4
	dc.w	1043,4,1044,-4

SPAboardbot	=	*-SPAlist
SPAboardbot_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	1249,4,1250,4,1251,4,1252,4,1253,4,1254,20,1045,4,1046,4
	dc.w	1047,4,1048,-4
.2	dc.w	1255,4,1256,4,1257,4,1258,4,1259,4,1260,20,1049,4,1050,4
	dc.w	1051,4,1052,-4
.4	dc.w	1261,4,1262,4,1263,4,1264,4,1265,4,1266,20,1037,4,1038,4
	dc.w	1039,4,1040,-4
.6	dc.w	1267,4,1268,4,1269,4,1270,4,1271,4,1272,20,1049,4,1050,4
	dc.w	1051,4,1052,-4

SPAboardmidr	=	*-SPAlist
SPAboardmidr_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.2-.t
	dc.w	.2-.t
	dc.w	.4-.t
	dc.w	.4-.t
	dc.w	.6-.t
	dc.w	.6-.t
	dc.w	0

.0	dc.w	1273,4,1274,4,1275,4,1276,4,1277,4,1278,20,1037,4,1038,4
	dc.w	1039,4,1040,-4
.2	dc.w	1279,4,1280,4,1281,4,1282,4,1283,4,1284,20,1049,4,1050,4
	dc.w	1051,4,1052,-4
.4	dc.w	1285,4,1286,4,1287,4,1288,4,1289,4,1290,20,1037,4,1038,4
	dc.w	1039,4,1040,-4
.6	dc.w	1291,4,1292,4,1293,4,1294,4,1295,4,1296,20,1041,4,1042,4
	dc.w	1043,4,1044,-4

SPA2576	=	*-SPAlist
SPA2576_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1297,6,1298,6,1299,6,1300,50,1301,8,1302,8,1037,6,1038,6
	dc.w	1039,6,1040,-6
.1	dc.w	1303,6,1304,6,1305,6,1306,50,1307,8,1308,8,1041,6,1042,6
	dc.w	1043,6,1044,-6
.2	dc.w	1309,6,1310,6,1311,6,1312,50,1313,8,1314,8,1041,6,1042,6
	dc.w	1043,6,1044,-6
.3	dc.w	1315,6,1316,6,1317,6,1318,50,1319,8,1320,8,1041,6,1042,6
	dc.w	1043,6,1044,-6
.4	dc.w	1321,6,1322,6,1323,6,1324,50,1325,8,1326,8,1045,6,1046,6
	dc.w	1047,6,1048,-6
.5	dc.w	1327,6,1328,6,1329,6,1330,50,1331,8,1332,8,1049,6,1050,6
	dc.w	1051,6,1052,-6
.6	dc.w	1333,6,1334,6,1335,6,1336,50,1337,8,1338,-8
	dc.w	1049,6,1050,6,1051,6,1052,-6	;past the end
.7	dc.w	1339,6,1340,6,1341,6,1342,50,1343,8,1344,-8
	dc.w	1049,6,1050,6,1051,6,1052,-6	;past the end

SPA26C8	=	*-SPAlist
SPA26C8_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1345,6,1346,6,1347,6,1348,6,1349,6,1350,50,1037,6,1038,6
	dc.w	1039,6,1040,-6
.1	dc.w	1351,6,1352,6,1353,6,1354,6,1355,6,1356,50,1041,6,1042,6
	dc.w	1043,6,1044,-6
.2	dc.w	1357,6,1358,6,1359,6,1360,6,1361,6,1362,50,1041,6,1042,6
	dc.w	1043,6,1044,-6
.3	dc.w	1363,6,1364,6,1365,6,1366,6,1367,6,1368,50,1041,6,1042,6
	dc.w	1043,6,1044,-6
.4	dc.w	1369,6,1370,6,1371,6,1372,6,1373,6,1374,50,1045,6,1046,6
	dc.w	1047,6,1048,-6
.5	dc.w	1375,6,1376,6,1377,6,1378,6,1379,6,1380,50,1049,6,1050,6
	dc.w	1051,6,1052,-6
.6	dc.w	1381,6,1382,6,1383,6,1384,6,1385,6,1386,50,1049,6,1050,6
	dc.w	1051,6,1052,-6
.7	dc.w	1387,6,1388,6,1389,6,1390,6,1391,6,1392,50,1049,6,1050,6
	dc.w	1051,6,1052,-6

SPA281A	=	*-SPAlist
SPA281A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	1

.0	dc.w	1393,3,1394,3,1395,-3
.1	dc.w	1396,3,1397,3,1398,-3
.2	dc.w	1399,3,1400,3,1401,-3
.3	dc.w	1402,3,1403,3,1404,-3
.4	dc.w	1405,3,1406,3,1407,-3
.5	dc.w	1408,3,1409,3,1410,-3
.6	dc.w	1411,3,1412,3,1413,-3
.7	dc.w	1414,3,1415,3,1416,-3

SPA288C	=	*-SPAlist
SPA288C_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	0

.0	dc.w	1417,6,1418,2,1419,2,1420,2,1421,2,1422,-4
.1	dc.w	1423,6,1424,2,1425,2,1426,2,1427,2,1428,-4

SPA28CE	=	*-SPAlist
SPA28CE_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	.1-.t
	dc.w	1

.0	dc.w	1429,3,1430,3,1431,3,1432,3,1433,3,1434,3,1435,3,1436,-3
.1	dc.w	1682,3,1683,3,1684,3,1685,3,1686,3,1687,3,1688,3,1689,-3

SPA2920	=	*-SPAlist
SPA2920_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	1

.0	dc.w	1682,3,1683,3,1684,3,1685,3,1686,3,1687,3,1688,3,1689,-3

SPA2952	=	*-SPAlist
SPA2952_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1702,8,1703,8,1704,8,1705,8,1706,8,1707,8,1708,8,1709,-8
.1	dc.w	1710,8,1711,8,1712,8,1713,8,1714,8,1715,8,1716,8,1717,-8
.2	dc.w	1718,8,1719,8,1720,8,1721,8,1722,8,1723,8,1724,8,1725,-8
.3	dc.w	1726,8,1727,8,1728,8,1729,8,1730,8,1731,8,1732,8,1733,-8
.4	dc.w	1734,8,1735,8,1736,8,1737,8,1738,8,1739,8,1740,8,1741,-8
.5	dc.w	1742,8,1743,8,1744,8,1745,8,1746,8,1747,8,1748,8,1749,-8
.6	dc.w	1750,8,1751,8,1752,8,1753,8,1754,8,1755,8,1756,8,1757,-8
.7	dc.w	1758,8,1759,8,1760,8,1761,8,1762,8,1763,8,1764,8,1765,-8

SPA2A64	=	*-SPAlist
SPA2A64_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1796,3,1797,3,1798,3,1799,-3
.1	dc.w	1800,3,1801,3,1802,3,1803,-3
.2	dc.w	1804,3,1805,3,1806,3,1807,-3
.3	dc.w	1808,3,1809,3,1810,3,1811,-3
.4	dc.w	1812,3,1813,3,1814,3,1815,-3
.5	dc.w	1816,3,1817,3,1818,3,1819,-3
.6	dc.w	1820,3,1821,3,1822,3,1823,-3
.7	dc.w	1824,3,1825,3,1826,3,1827,-3

SPA2AF6	=	*-SPAlist
SPA2AF6_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1799,3,1798,3,1797,3,1796,-3
.1	dc.w	1803,3,1802,3,1801,3,1800,-3
.2	dc.w	1807,3,1806,3,1805,3,1804,-3
.3	dc.w	1811,3,1810,3,1809,3,1808,-3
.4	dc.w	1815,3,1814,3,1813,3,1812,-3
.5	dc.w	1819,3,1818,3,1817,3,1816,-3
.6	dc.w	1823,3,1822,3,1821,3,1820,-3
.7	dc.w	1827,3,1826,3,1825,3,1824,-3

SPA2B88	=	*-SPAlist
SPA2B88_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	1850,8,1851,8,1852,8,1853,8,1854,8,1855,8,1856,8,1857,-1000

SPA2BBA	=	*-SPAlist
SPA2BBA_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	1

.0	dc.w	667,4,668,4,669,4,670,4,671,4,668,4,672,4,666,-4
.1	dc.w	674,2,666,2,673,2,670,2,675,2,670,2,673,2,666,-2
.2	dc.w	669,2,668,2,667,2,666,2,672,2,668,2,671,2,670,-2
.3	dc.w	673,4,666,4,674,4,666,4,673,4,670,4,675,4,670,-4
.4	dc.w	666,-4096
.5	dc.w	666,-4096
.6	dc.w	670,-4096
.7	dc.w	670,-4096

SPAburst	=	*-SPAlist
SPAburst_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1702,2,1703,2,1704,2,1705,2,1706,2,1707,2,1708,2,1709,-2
.1	dc.w	1710,2,1711,2,1712,2,1713,2,1714,2,1715,2,1716,2,1717,-2
.2	dc.w	1718,2,1719,2,1720,2,1721,2,1722,2,1723,2,1724,2,1725,-2
.3	dc.w	1726,2,1727,2,1728,2,1729,2,1730,2,1731,2,1732,2,1733,-2
.4	dc.w	1734,2,1735,2,1736,2,1737,2,1738,2,1739,2,1740,2,1741,-2
.5	dc.w	1742,2,1743,2,1744,2,1745,2,1746,2,1747,2,1748,2,1749,-2
.6	dc.w	1750,2,1751,2,1752,2,1753,2,1754,2,1755,2,1756,2,1757,-2
.7	dc.w	1758,2,1759,2,1760,2,1761,2,1762,2,1763,2,1764,2,1765,-2

SPA2D6E	=	*-SPAlist
SPA2D6E_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	1101,4,1108,4,1161,20,1116,4,1109,4,1110,-4
.1	dc.w	1102,4,1101,4,1165,20,1109,4,1110,4,1111,-4
.2	dc.w	1103,4,1102,4,1137,20,1110,4,1111,4,1112,-4
.3	dc.w	1104,4,1103,4,1141,20,1111,4,1112,4,1113,-4
.4	dc.w	1105,4,1104,4,1145,20,1112,4,1113,4,1114,-4
.5	dc.w	1106,4,1105,4,1149,20,1113,4,1114,4,1115,-4
.6	dc.w	1107,4,1106,4,1153,20,1114,4,1115,4,1116,-4
.7	dc.w	1108,4,1107,4,1157,20,1115,4,1116,4,1109,-4

SPA2E40	=	*-SPAlist
SPA2E40_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	760,4,759,4,758,4,757,4,758,4,759,4,760,4,760,4
	dc.w	760,-10
.1	dc.w	766,4,765,4,764,4,763,4,764,4,765,4,766,4,766,4
	dc.w	766,-10
.2	dc.w	772,4,771,4,770,4,769,4,770,4,771,4,772,4,772,4
	dc.w	772,-10
.3	dc.w	778,4,777,4,776,4,775,4,776,4,777,4,778,4,778,4
	dc.w	778,-10
.4	dc.w	784,4,783,4,782,4,781,4,782,4,783,4,784,4,784,4
	dc.w	784,-10
.5	dc.w	790,4,789,4,788,4,787,4,788,4,789,4,790,4,790,4
	dc.w	790,-10
.6	dc.w	796,4,795,4,794,4,793,4,794,4,795,4,796,4,796,4
	dc.w	796,-10
.7	dc.w	802,4,801,4,800,4,799,4,800,4,801,4,802,4,802,4
	dc.w	802,-10

SPA2F72	=	*-SPAlist
SPA2F72_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.1-.t
	dc.w	.2-.t
	dc.w	.3-.t
	dc.w	.4-.t
	dc.w	.5-.t
	dc.w	.6-.t
	dc.w	.7-.t
	dc.w	0

.0	dc.w	683,4,682,4,681,4,681,4,681,4,682,4,683,4,684,4
	dc.w	684,-10
.1	dc.w	687,4,686,4,685,4,685,4,685,4,686,4,687,4,688,4
	dc.w	688,-10
.2	dc.w	1678,4,1677,4,1676,4,1676,4,1676,4,1677,4,1678,4,1679,4
	dc.w	1679,-10
.3	dc.w	691,4,690,4,689,4,689,4,689,4,690,4,691,4,692,4
	dc.w	692,-10
.4	dc.w	695,4,694,4,693,4,693,4,693,4,694,4,695,4,696,4
	dc.w	696,-10
.5	dc.w	699,4,698,4,697,4,697,4,697,4,698,4,699,4,700,4
	dc.w	700,-10
.6	dc.w	703,4,702,4,701,4,701,4,701,4,702,4,703,4,704,4
	dc.w	704,-10
.7	dc.w	707,4,706,4,705,4,705,4,705,4,706,4,707,4,708,4
	dc.w	708,-10

SPAfight	=	*-SPAlist
SPAfight_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	1

.0	dc.w	1507,8,1508,8,1509,8,1510,8,1509,8,1508,-8
.3	dc.w	1507,8,1508,8,1509,8,1510,8,1509,8,1508,-8

SPA30E6	=	*-SPAlist
SPA30E6_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	2

.0	dc.w	1515,7,1516,7,1517,7,1518,7,1517,7,1516,-7
.3	dc.w	1519,7,1520,7,1521,7,1522,7,1521,7,1520,-7

SPA3128	=	*-SPAlist
SPA3128_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1511,4,1512,4,1513,4,1514,4,1515,4,1516,4,1517,4,1518,4
	dc.w	1516,-4
.3	dc.w	1511,4,1512,4,1513,4,1514,4,1519,4,1520,4,1521,4,1522,4
	dc.w	1520,-4

SPA3182	=	*-SPAlist
SPA3182_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1595,4,1596,4,1597,4,1598,4,1516,-15
.3	dc.w	1599,4,1600,4,1601,4,1602,4,1520,-15

SPAfhigh	=	*-SPAlist
SPAfhigh_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	2

.0	dc.w	1555,6,1556,6,1557,6,1558,6,1516,-4
.3	dc.w	1559,6,1560,6,1561,6,1562,6,1520,-4

SPA31F6	=	*-SPAlist
SPA31F6_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1555,6,1556,6,1557,6,1558,6,1516,-4
.3	dc.w	1559,6,1560,6,1561,6,1562,6,1520,-4

SPA3230	=	*-SPAlist
SPA3230_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1517,4,1516,-4
.3	dc.w	1521,4,1520,-4

SPA3252	=	*-SPAlist
SPA3252_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1563,6,1564,8,1565,8,1566,4,1516,-4
.3	dc.w	1567,6,1568,8,1569,8,1570,4,1520,-4

SPAfgrab	=	*-SPAlist
SPAfgrab_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1523,4,1524,4,1525,4,1526,14,1516,-15
.3	dc.w	1527,4,1528,4,1529,4,1530,14,1520,-15

SPAflow	=	*-SPAlist
SPAflow_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1539,4,1540,4,1541,4,1542,14,1516,-15
.3	dc.w	1543,4,1544,4,1545,4,1546,14,1520,-15

SPA3300	=	*-SPAlist
SPA3300_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1651,6,1652,8,1653,8,1654,4,1516,-16
.3	dc.w	1651,6,1652,8,1653,8,1654,4,1520,-16

SPA333A	=	*-SPAlist
SPA333A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1579,6,1580,8,1581,8,1582,4,1516,-4
.3	dc.w	1583,6,1584,8,1585,8,1586,4,1520,-4

SPA3374	=	*-SPAlist
SPA3374_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1531,3,1532,3,1533,3,1534,8,1516,-4
.3	dc.w	1535,3,1536,3,1537,3,1538,8,1520,-4

SPA33AE	=	*-SPAlist
SPA33AE_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1531,3,1532,3,1533,3,1534,7,1516,-4
.3	dc.w	1535,3,1536,3,1537,3,1538,7,1520,-4

SPA33E8	=	*-SPAlist
SPA33E8_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1531,3,1532,3,1533,3,1534,6,1516,-4
.3	dc.w	1535,3,1536,3,1537,3,1538,6,1520,-4

SPA3422	=	*-SPAlist
SPA3422_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1547,3,1548,3,1549,3,1550,8,1516,-4
.3	dc.w	1551,3,1552,3,1553,3,1554,8,1520,-4

SPA345C	=	*-SPAlist
SPA345C_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1547,3,1548,3,1549,3,1550,7,1516,-4
.3	dc.w	1551,3,1552,3,1553,3,1554,7,1520,-4

SPA3496	=	*-SPAlist
SPA3496_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1547,3,1548,3,1549,3,1550,6,1516,-4
.3	dc.w	1551,3,1552,3,1553,3,1554,6,1520,-4

SPA34D0	=	*-SPAlist
SPA34D0_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1603,7,1604,7,1605,8,1606,8,1516,-8
.3	dc.w	1607,7,1608,7,1609,8,1610,8,1520,-8

SPA350A	=	*-SPAlist
SPA350A_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1571,7,1572,7,1573,8,1574,8,1516,-8
.3	dc.w	1575,7,1576,7,1577,8,1578,8,1520,-8

SPA3544	=	*-SPAlist
SPA3544_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1571,6,1572,6,1573,6,1574,6,1516,-8
.3	dc.w	1575,6,1576,6,1577,6,1578,6,1520,-8

SPA357E	=	*-SPAlist
SPA357E_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1571,4,1572,4,1573,4,1574,4,1516,-8
.3	dc.w	1575,4,1576,4,1577,4,1578,4,1520,-8

SPA35B8	=	*-SPAlist
SPA35B8_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1587,7,1588,7,1589,8,1590,8,1516,-8
.3	dc.w	1591,7,1592,7,1593,8,1594,8,1520,-8

SPA35F2	=	*-SPAlist
SPA35F2_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1587,6,1588,6,1589,6,1590,6,1516,-8
.3	dc.w	1591,6,1592,6,1593,6,1594,6,1520,-8

SPA362C	=	*-SPAlist
SPA362C_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	.3-.t
	dc.w	0

.0	dc.w	1587,4,1588,4,1589,4,1590,4,1516,-8
.3	dc.w	1591,4,1592,4,1593,4,1594,4,1520,-8

SPA3666	=	*-SPAlist
SPA3666_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	1643,8,1644,8,1645,8,1646,8,1646,8,1646,8,1646,8,1646,8
	dc.w	1516,-2

SPA369C	=	*-SPAlist
SPA369C_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	1647,8,1648,8,1649,8,1650,8,1650,8,1650,8,1650,8,1650,160
	dc.w	1650,-2

SPA36D2	=	*-SPAlist
SPA36D2_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	1655,8,1656,8,1657,8,1658,90,1658,-2

SPA36F8	=	*-SPAlist
SPA36F8_table:
.t									;Offset to each direction of animation (0-7)
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	.0-.t
	dc.w	0

.0	dc.w	1527,8,1528,8,1529,20,1530,8,1531,8,1532,8,1533,10,1534,10
	dc.w	1535,10,1533,10,1534,10,1535,10,1533,10,1534,10,1535,10,1533,10
	dc.w	1534,10,1535,-400
