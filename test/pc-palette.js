const A=require('../lib/pc-palette');const assert=require('assert');
const colors=Array.from({length:64},(_,i)=>[i,i,i]);
const rgba=new Uint8Array([252,0,0,255, 0,252,0,255, 8,8,8,255, 0,0,0,0]);
let a=A.allocate(rgba,colors,[],{team:true,freeOnly:true},{jersey:new Set([0,1,2,3]),crest:new Set([10]),tiles:new Set()});
assert.strictEqual(a.indexOf(8,8,8),130,'exact reuse');assert.ok(!a.written.includes(0)&&!a.written.includes(10));assert.strictEqual(a.written.length,2);

a=A.allocate(rgba,colors,[{index:5,rgb6:[63,0,0]}],{team:false,rink:true},{});assert.strictEqual(a.indexOf(252,0,0),5);assert.strictEqual(a.written.length,0);
assert.ok(A.conflicts({team:true,overwrite:true}).freeOnly);
console.log('pc-palette: ok');
