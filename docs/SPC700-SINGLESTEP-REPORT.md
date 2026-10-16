# spc700-cpu.js vs SingleStepTests SPC700 (v1)

A test passes when A, X, Y, SP, PC, PSW and every listed RAM byte match, nothing else was written, and the cycle count equals the length of the suite's bus trace. The order of bus accesses is not compared.

**Total: 256000 / 256000 (100%)**

## Per instruction group

| Group | Opcodes | Pass | Tests |
|---|---|---|---|
| ADC | 12 | 100% | 12000/12000 |
| ADDW | 1 | 100% | 1000/1000 |
| AND | 12 | 100% | 12000/12000 |
| AND1 | 2 | 100% | 2000/2000 |
| ASL | 4 | 100% | 4000/4000 |
| BBC | 8 | 100% | 8000/8000 |
| BBS | 8 | 100% | 8000/8000 |
| BCC | 1 | 100% | 1000/1000 |
| BCS | 1 | 100% | 1000/1000 |
| BEQ | 1 | 100% | 1000/1000 |
| BMI | 1 | 100% | 1000/1000 |
| BNE | 1 | 100% | 1000/1000 |
| BPL | 1 | 100% | 1000/1000 |
| BRA | 1 | 100% | 1000/1000 |
| BRK | 1 | 100% | 1000/1000 |
| BVC | 1 | 100% | 1000/1000 |
| BVS | 1 | 100% | 1000/1000 |
| CALL | 1 | 100% | 1000/1000 |
| CBNE | 2 | 100% | 2000/2000 |
| CLR1 | 8 | 100% | 8000/8000 |
| CLRC | 1 | 100% | 1000/1000 |
| CLRP | 1 | 100% | 1000/1000 |
| CLRV | 1 | 100% | 1000/1000 |
| CMP | 18 | 100% | 18000/18000 |
| CMPW | 1 | 100% | 1000/1000 |
| DAA | 1 | 100% | 1000/1000 |
| DAS | 1 | 100% | 1000/1000 |
| DBNZ | 2 | 100% | 2000/2000 |
| DEC | 6 | 100% | 6000/6000 |
| DECW | 1 | 100% | 1000/1000 |
| DI | 1 | 100% | 1000/1000 |
| DIV | 1 | 100% | 1000/1000 |
| EI | 1 | 100% | 1000/1000 |
| EOR | 12 | 100% | 12000/12000 |
| EOR1 | 1 | 100% | 1000/1000 |
| INC | 6 | 100% | 6000/6000 |
| INCW | 1 | 100% | 1000/1000 |
| JMP | 2 | 100% | 2000/2000 |
| LSR | 4 | 100% | 4000/4000 |
| MOV | 41 | 100% | 41000/41000 |
| MOV1 | 2 | 100% | 2000/2000 |
| MOVW | 2 | 100% | 2000/2000 |
| MUL | 1 | 100% | 1000/1000 |
| NOP | 1 | 100% | 1000/1000 |
| NOT1 | 1 | 100% | 1000/1000 |
| NOTC | 1 | 100% | 1000/1000 |
| OR | 12 | 100% | 12000/12000 |
| OR1 | 2 | 100% | 2000/2000 |
| PCALL | 1 | 100% | 1000/1000 |
| POP | 4 | 100% | 4000/4000 |
| PUSH | 4 | 100% | 4000/4000 |
| RET | 1 | 100% | 1000/1000 |
| RETI | 1 | 100% | 1000/1000 |
| ROL | 4 | 100% | 4000/4000 |
| ROR | 4 | 100% | 4000/4000 |
| SBC | 12 | 100% | 12000/12000 |
| SET1 | 8 | 100% | 8000/8000 |
| SETC | 1 | 100% | 1000/1000 |
| SETP | 1 | 100% | 1000/1000 |
| SLEEP | 1 | 100% | 1000/1000 |
| STOP | 1 | 100% | 1000/1000 |
| SUBW | 1 | 100% | 1000/1000 |
| TCALL | 16 | 100% | 16000/16000 |
| TCLR1 | 1 | 100% | 1000/1000 |
| TSET1 | 1 | 100% | 1000/1000 |
| XCN | 1 | 100% | 1000/1000 |

## Per opcode

| Opcode | Instruction | Used by the 93S/94S sound drivers | Pass | Tests |
|---|---|---|---|---|
| $00 | NOP | yes | 100% | 1000/1000 |
| $01 | TCALL 0 | only in a linear sweep | 100% | 1000/1000 |
| $02 | SET1 d.0 | only in a linear sweep | 100% | 1000/1000 |
| $03 | BBS d.0,r | only in a linear sweep | 100% | 1000/1000 |
| $04 | OR A,d | yes | 100% | 1000/1000 |
| $05 | OR A,!a | only in a linear sweep | 100% | 1000/1000 |
| $06 | OR A,(X) | only in a linear sweep | 100% | 1000/1000 |
| $07 | OR A,[d+X] | only in a linear sweep | 100% | 1000/1000 |
| $08 | OR A,#i | yes | 100% | 1000/1000 |
| $09 | OR dd,ds | yes | 100% | 1000/1000 |
| $0a | OR1 C,m.b | only in a linear sweep | 100% | 1000/1000 |
| $0b | ASL d | yes | 100% | 1000/1000 |
| $0c | ASL !a | only in a linear sweep | 100% | 1000/1000 |
| $0d | PUSH PSW | only in a linear sweep | 100% | 1000/1000 |
| $0e | TSET1 !a | yes | 100% | 1000/1000 |
| $0f | BRK | only in a linear sweep | 100% | 1000/1000 |
| $10 | BPL r | yes | 100% | 1000/1000 |
| $11 | TCALL 1 | only in a linear sweep | 100% | 1000/1000 |
| $12 | CLR1 d.0 | only in a linear sweep | 100% | 1000/1000 |
| $13 | BBC d.0,r | yes | 100% | 1000/1000 |
| $14 | OR A,d+X | only in a linear sweep | 100% | 1000/1000 |
| $15 | OR A,!a+X | only in a linear sweep | 100% | 1000/1000 |
| $16 | OR A,!a+Y | only in a linear sweep | 100% | 1000/1000 |
| $17 | OR A,[d]+Y | only in a linear sweep | 100% | 1000/1000 |
| $18 | OR d,#i | only in a linear sweep | 100% | 1000/1000 |
| $19 | OR (X),(Y) | only in a linear sweep | 100% | 1000/1000 |
| $1a | DECW d | yes | 100% | 1000/1000 |
| $1b | ASL d+X | only in a linear sweep | 100% | 1000/1000 |
| $1c | ASL A | yes | 100% | 1000/1000 |
| $1d | DEC X | yes | 100% | 1000/1000 |
| $1e | CMP X,!a | only in a linear sweep | 100% | 1000/1000 |
| $1f | JMP [!a+X] | yes | 100% | 1000/1000 |
| $20 | CLRP | yes | 100% | 1000/1000 |
| $21 | TCALL 2 | only in a linear sweep | 100% | 1000/1000 |
| $22 | SET1 d.1 | only in a linear sweep | 100% | 1000/1000 |
| $23 | BBS d.1,r | only in a linear sweep | 100% | 1000/1000 |
| $24 | AND A,d | yes | 100% | 1000/1000 |
| $25 | AND A,!a | only in a linear sweep | 100% | 1000/1000 |
| $26 | AND A,(X) | only in a linear sweep | 100% | 1000/1000 |
| $27 | AND A,[d+X] | only in a linear sweep | 100% | 1000/1000 |
| $28 | AND A,#i | yes | 100% | 1000/1000 |
| $29 | AND dd,ds | only in a linear sweep | 100% | 1000/1000 |
| $2a | OR1 C,/m.b | only in a linear sweep | 100% | 1000/1000 |
| $2b | ROL d | yes | 100% | 1000/1000 |
| $2c | ROL !a | only in a linear sweep | 100% | 1000/1000 |
| $2d | PUSH A | yes | 100% | 1000/1000 |
| $2e | CBNE d,r | only in a linear sweep | 100% | 1000/1000 |
| $2f | BRA r | yes | 100% | 1000/1000 |
| $30 | BMI r | yes | 100% | 1000/1000 |
| $31 | TCALL 3 | only in a linear sweep | 100% | 1000/1000 |
| $32 | CLR1 d.1 | only in a linear sweep | 100% | 1000/1000 |
| $33 | BBC d.1,r | yes | 100% | 1000/1000 |
| $34 | AND A,d+X | only in a linear sweep | 100% | 1000/1000 |
| $35 | AND A,!a+X | only in a linear sweep | 100% | 1000/1000 |
| $36 | AND A,!a+Y |  | 100% | 1000/1000 |
| $37 | AND A,[d]+Y |  | 100% | 1000/1000 |
| $38 | AND d,#i | yes | 100% | 1000/1000 |
| $39 | AND (X),(Y) | only in a linear sweep | 100% | 1000/1000 |
| $3a | INCW d | yes | 100% | 1000/1000 |
| $3b | ROL d+X | only in a linear sweep | 100% | 1000/1000 |
| $3c | ROL A | only in a linear sweep | 100% | 1000/1000 |
| $3d | INC X | yes | 100% | 1000/1000 |
| $3e | CMP X,d | yes | 100% | 1000/1000 |
| $3f | CALL !a | yes | 100% | 1000/1000 |
| $40 | SETP | only in a linear sweep | 100% | 1000/1000 |
| $41 | TCALL 4 | only in a linear sweep | 100% | 1000/1000 |
| $42 | SET1 d.2 |  | 100% | 1000/1000 |
| $43 | BBS d.2,r | only in a linear sweep | 100% | 1000/1000 |
| $44 | EOR A,d | yes | 100% | 1000/1000 |
| $45 | EOR A,!a | only in a linear sweep | 100% | 1000/1000 |
| $46 | EOR A,(X) | only in a linear sweep | 100% | 1000/1000 |
| $47 | EOR A,[d+X] |  | 100% | 1000/1000 |
| $48 | EOR A,#i | yes | 100% | 1000/1000 |
| $49 | EOR dd,ds |  | 100% | 1000/1000 |
| $4a | AND1 C,m.b | only in a linear sweep | 100% | 1000/1000 |
| $4b | LSR d | yes | 100% | 1000/1000 |
| $4c | LSR !a |  | 100% | 1000/1000 |
| $4d | PUSH X | yes | 100% | 1000/1000 |
| $4e | TCLR1 !a | yes | 100% | 1000/1000 |
| $4f | PCALL u |  | 100% | 1000/1000 |
| $50 | BVC r | only in a linear sweep | 100% | 1000/1000 |
| $51 | TCALL 5 | only in a linear sweep | 100% | 1000/1000 |
| $52 | CLR1 d.2 |  | 100% | 1000/1000 |
| $53 | BBC d.2,r |  | 100% | 1000/1000 |
| $54 | EOR A,d+X | only in a linear sweep | 100% | 1000/1000 |
| $55 | EOR A,!a+X | only in a linear sweep | 100% | 1000/1000 |
| $56 | EOR A,!a+Y |  | 100% | 1000/1000 |
| $57 | EOR A,[d]+Y | only in a linear sweep | 100% | 1000/1000 |
| $58 | EOR d,#i | only in a linear sweep | 100% | 1000/1000 |
| $59 | EOR (X),(Y) |  | 100% | 1000/1000 |
| $5a | CMPW YA,d | only in a linear sweep | 100% | 1000/1000 |
| $5b | LSR d+X | only in a linear sweep | 100% | 1000/1000 |
| $5c | LSR A | yes | 100% | 1000/1000 |
| $5d | MOV X,A | yes | 100% | 1000/1000 |
| $5e | CMP Y,!a | only in a linear sweep | 100% | 1000/1000 |
| $5f | JMP !a | yes | 100% | 1000/1000 |
| $60 | CLRC | yes | 100% | 1000/1000 |
| $61 | TCALL 6 |  | 100% | 1000/1000 |
| $62 | SET1 d.3 | only in a linear sweep | 100% | 1000/1000 |
| $63 | BBS d.3,r | only in a linear sweep | 100% | 1000/1000 |
| $64 | CMP A,d | yes | 100% | 1000/1000 |
| $65 | CMP A,!a | only in a linear sweep | 100% | 1000/1000 |
| $66 | CMP A,(X) |  | 100% | 1000/1000 |
| $67 | CMP A,[d+X] | only in a linear sweep | 100% | 1000/1000 |
| $68 | CMP A,#i | yes | 100% | 1000/1000 |
| $69 | CMP dd,ds | yes | 100% | 1000/1000 |
| $6a | AND1 C,/m.b |  | 100% | 1000/1000 |
| $6b | ROR d | yes | 100% | 1000/1000 |
| $6c | ROR !a | only in a linear sweep | 100% | 1000/1000 |
| $6d | PUSH Y | yes | 100% | 1000/1000 |
| $6e | DBNZ d,r | yes | 100% | 1000/1000 |
| $6f | RET | yes | 100% | 1000/1000 |
| $70 | BVS r | only in a linear sweep | 100% | 1000/1000 |
| $71 | TCALL 7 |  | 100% | 1000/1000 |
| $72 | CLR1 d.3 | only in a linear sweep | 100% | 1000/1000 |
| $73 | BBC d.3,r | only in a linear sweep | 100% | 1000/1000 |
| $74 | CMP A,d+X | only in a linear sweep | 100% | 1000/1000 |
| $75 | CMP A,!a+X | yes | 100% | 1000/1000 |
| $76 | CMP A,!a+Y |  | 100% | 1000/1000 |
| $77 | CMP A,[d]+Y |  | 100% | 1000/1000 |
| $78 | CMP d,#i | yes | 100% | 1000/1000 |
| $79 | CMP (X),(Y) | only in a linear sweep | 100% | 1000/1000 |
| $7a | ADDW YA,d | yes | 100% | 1000/1000 |
| $7b | ROR d+X | only in a linear sweep | 100% | 1000/1000 |
| $7c | ROR A | yes | 100% | 1000/1000 |
| $7d | MOV A,X | yes | 100% | 1000/1000 |
| $7e | CMP Y,d | yes | 100% | 1000/1000 |
| $7f | RETI | only in a linear sweep | 100% | 1000/1000 |
| $80 | SETC | yes | 100% | 1000/1000 |
| $81 | TCALL 8 | only in a linear sweep | 100% | 1000/1000 |
| $82 | SET1 d.4 | only in a linear sweep | 100% | 1000/1000 |
| $83 | BBS d.4,r | only in a linear sweep | 100% | 1000/1000 |
| $84 | ADC A,d | yes | 100% | 1000/1000 |
| $85 | ADC A,!a | only in a linear sweep | 100% | 1000/1000 |
| $86 | ADC A,(X) | only in a linear sweep | 100% | 1000/1000 |
| $87 | ADC A,[d+X] | only in a linear sweep | 100% | 1000/1000 |
| $88 | ADC A,#i | yes | 100% | 1000/1000 |
| $89 | ADC dd,ds | only in a linear sweep | 100% | 1000/1000 |
| $8a | EOR1 C,m.b | only in a linear sweep | 100% | 1000/1000 |
| $8b | DEC d | yes | 100% | 1000/1000 |
| $8c | DEC !a | only in a linear sweep | 100% | 1000/1000 |
| $8d | MOV Y,#i | yes | 100% | 1000/1000 |
| $8e | POP PSW | only in a linear sweep | 100% | 1000/1000 |
| $8f | MOV d,#i | yes | 100% | 1000/1000 |
| $90 | BCC r | yes | 100% | 1000/1000 |
| $91 | TCALL 9 | only in a linear sweep | 100% | 1000/1000 |
| $92 | CLR1 d.4 | only in a linear sweep | 100% | 1000/1000 |
| $93 | BBC d.4,r | only in a linear sweep | 100% | 1000/1000 |
| $94 | ADC A,d+X | only in a linear sweep | 100% | 1000/1000 |
| $95 | ADC A,!a+X | yes | 100% | 1000/1000 |
| $96 | ADC A,!a+Y | yes | 100% | 1000/1000 |
| $97 | ADC A,[d]+Y | yes | 100% | 1000/1000 |
| $98 | ADC d,#i | yes | 100% | 1000/1000 |
| $99 | ADC (X),(Y) | only in a linear sweep | 100% | 1000/1000 |
| $9a | SUBW YA,d | yes | 100% | 1000/1000 |
| $9b | DEC d+X | yes | 100% | 1000/1000 |
| $9c | DEC A | yes | 100% | 1000/1000 |
| $9d | MOV X,SP | only in a linear sweep | 100% | 1000/1000 |
| $9e | DIV YA,X | yes | 100% | 1000/1000 |
| $9f | XCN A | yes | 100% | 1000/1000 |
| $a0 | EI | only in a linear sweep | 100% | 1000/1000 |
| $a1 | TCALL 10 | only in a linear sweep | 100% | 1000/1000 |
| $a2 | SET1 d.5 | yes | 100% | 1000/1000 |
| $a3 | BBS d.5,r | only in a linear sweep | 100% | 1000/1000 |
| $a4 | SBC A,d | yes | 100% | 1000/1000 |
| $a5 | SBC A,!a | only in a linear sweep | 100% | 1000/1000 |
| $a6 | SBC A,(X) | only in a linear sweep | 100% | 1000/1000 |
| $a7 | SBC A,[d+X] | only in a linear sweep | 100% | 1000/1000 |
| $a8 | SBC A,#i | yes | 100% | 1000/1000 |
| $a9 | SBC dd,ds | only in a linear sweep | 100% | 1000/1000 |
| $aa | MOV1 C,m.b | only in a linear sweep | 100% | 1000/1000 |
| $ab | INC d | yes | 100% | 1000/1000 |
| $ac | INC !a | only in a linear sweep | 100% | 1000/1000 |
| $ad | CMP Y,#i | yes | 100% | 1000/1000 |
| $ae | POP A | yes | 100% | 1000/1000 |
| $af | MOV (X)+,A | yes | 100% | 1000/1000 |
| $b0 | BCS r | yes | 100% | 1000/1000 |
| $b1 | TCALL 11 |  | 100% | 1000/1000 |
| $b2 | CLR1 d.5 | only in a linear sweep | 100% | 1000/1000 |
| $b3 | BBC d.5,r |  | 100% | 1000/1000 |
| $b4 | SBC A,d+X | only in a linear sweep | 100% | 1000/1000 |
| $b5 | SBC A,!a+X | yes | 100% | 1000/1000 |
| $b6 | SBC A,!a+Y | yes | 100% | 1000/1000 |
| $b7 | SBC A,[d]+Y | only in a linear sweep | 100% | 1000/1000 |
| $b8 | SBC d,#i |  | 100% | 1000/1000 |
| $b9 | SBC (X),(Y) | only in a linear sweep | 100% | 1000/1000 |
| $ba | MOVW YA,d | yes | 100% | 1000/1000 |
| $bb | INC d+X | yes | 100% | 1000/1000 |
| $bc | INC A | yes | 100% | 1000/1000 |
| $bd | MOV SP,X | yes | 100% | 1000/1000 |
| $be | DAS A | only in a linear sweep | 100% | 1000/1000 |
| $bf | MOV A,(X)+ |  | 100% | 1000/1000 |
| $c0 | DI | only in a linear sweep | 100% | 1000/1000 |
| $c1 | TCALL 12 |  | 100% | 1000/1000 |
| $c2 | SET1 d.6 | only in a linear sweep | 100% | 1000/1000 |
| $c3 | BBS d.6,r |  | 100% | 1000/1000 |
| $c4 | MOV d,A | yes | 100% | 1000/1000 |
| $c5 | MOV !a,A | yes | 100% | 1000/1000 |
| $c6 | MOV (X),A |  | 100% | 1000/1000 |
| $c7 | MOV [d+X],A |  | 100% | 1000/1000 |
| $c8 | CMP X,#i | yes | 100% | 1000/1000 |
| $c9 | MOV !a,X | yes | 100% | 1000/1000 |
| $ca | MOV1 m.b,C | only in a linear sweep | 100% | 1000/1000 |
| $cb | MOV d,Y | yes | 100% | 1000/1000 |
| $cc | MOV !a,Y | yes | 100% | 1000/1000 |
| $cd | MOV X,#i | yes | 100% | 1000/1000 |
| $ce | POP X | yes | 100% | 1000/1000 |
| $cf | MUL YA | yes | 100% | 1000/1000 |
| $d0 | BNE r | yes | 100% | 1000/1000 |
| $d1 | TCALL 13 |  | 100% | 1000/1000 |
| $d2 | CLR1 d.6 | only in a linear sweep | 100% | 1000/1000 |
| $d3 | BBC d.6,r |  | 100% | 1000/1000 |
| $d4 | MOV d+X,A | yes | 100% | 1000/1000 |
| $d5 | MOV !a+X,A | yes | 100% | 1000/1000 |
| $d6 | MOV !a+Y,A | yes | 100% | 1000/1000 |
| $d7 | MOV [d]+Y,A | yes | 100% | 1000/1000 |
| $d8 | MOV d,X | yes | 100% | 1000/1000 |
| $d9 | MOV d+Y,X |  | 100% | 1000/1000 |
| $da | MOVW d,YA | yes | 100% | 1000/1000 |
| $db | MOV d+X,Y |  | 100% | 1000/1000 |
| $dc | DEC Y | yes | 100% | 1000/1000 |
| $dd | MOV A,Y | yes | 100% | 1000/1000 |
| $de | CBNE d+X,r | yes | 100% | 1000/1000 |
| $df | DAA A | only in a linear sweep | 100% | 1000/1000 |
| $e0 | CLRV | only in a linear sweep | 100% | 1000/1000 |
| $e1 | TCALL 14 | only in a linear sweep | 100% | 1000/1000 |
| $e2 | SET1 d.7 | yes | 100% | 1000/1000 |
| $e3 | BBS d.7,r | yes | 100% | 1000/1000 |
| $e4 | MOV A,d | yes | 100% | 1000/1000 |
| $e5 | MOV A,!a | yes | 100% | 1000/1000 |
| $e6 | MOV A,(X) | yes | 100% | 1000/1000 |
| $e7 | MOV A,[d+X] | yes | 100% | 1000/1000 |
| $e8 | MOV A,#i | yes | 100% | 1000/1000 |
| $e9 | MOV X,!a |  | 100% | 1000/1000 |
| $ea | NOT1 m.b | only in a linear sweep | 100% | 1000/1000 |
| $eb | MOV Y,d | yes | 100% | 1000/1000 |
| $ec | MOV Y,!a | yes | 100% | 1000/1000 |
| $ed | NOTC | yes | 100% | 1000/1000 |
| $ee | POP Y | yes | 100% | 1000/1000 |
| $ef | SLEEP | only in a linear sweep | 100% | 1000/1000 |
| $f0 | BEQ r | yes | 100% | 1000/1000 |
| $f1 | TCALL 15 | only in a linear sweep | 100% | 1000/1000 |
| $f2 | CLR1 d.7 | yes | 100% | 1000/1000 |
| $f3 | BBC d.7,r | yes | 100% | 1000/1000 |
| $f4 | MOV A,d+X | yes | 100% | 1000/1000 |
| $f5 | MOV A,!a+X | yes | 100% | 1000/1000 |
| $f6 | MOV A,!a+Y | yes | 100% | 1000/1000 |
| $f7 | MOV A,[d]+Y | yes | 100% | 1000/1000 |
| $f8 | MOV X,d | yes | 100% | 1000/1000 |
| $f9 | MOV X,d+Y | only in a linear sweep | 100% | 1000/1000 |
| $fa | MOV dd,ds | only in a linear sweep | 100% | 1000/1000 |
| $fb | MOV Y,d+X | yes | 100% | 1000/1000 |
| $fc | INC Y | yes | 100% | 1000/1000 |
| $fd | MOV Y,A | yes | 100% | 1000/1000 |
| $fe | DBNZ Y,r | yes | 100% | 1000/1000 |
| $ff | STOP | only in a linear sweep | 100% | 1000/1000 |
