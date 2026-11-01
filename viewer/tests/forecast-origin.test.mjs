import test from 'node:test';
import assert from 'node:assert/strict';
import {originObservation} from '../ui.mjs';

test('origin observation uses full saved series and equivalent timestamp encodings',()=>{
 const rows=[{target_time:'2024-01-01T00:00:00+00:00',observed:12},{target_time:'2024-01-01T06:00:00Z',observed:30}];
 assert.equal(originObservation(rows,{origin_time:'2024-01-01T00:00:00Z'}),12);
 assert.equal(originObservation(rows,{origin_time:'2023-12-31T23:00:00Z'}),null);
 assert.equal(originObservation([{target_time:rows[0].target_time,observed:null}],{origin_time:rows[0].target_time}),null);
});
