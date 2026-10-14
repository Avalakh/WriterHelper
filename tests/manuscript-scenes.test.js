import test from 'node:test';
import assert from 'node:assert/strict';
import { manuscriptBoundaries } from '../src/state/manuscriptScenes.ts';
test('Scene markers are standalone lines and retain exact source offsets',()=>{
 const text='# Глава\r\n\r\nНачало.\r\n\r\n* * *\r\nСледующая сцена.\n*** Интерлюдия ***\nЧужой POV.\n***Конец интерлюдии***\nКонец.\n---\nДальше.';
 const marks=manuscriptBoundaries(text);
 assert.deepEqual(marks.map(m=>m.label),['Сцена 2','Интерлюдия','Возвращение к основному повествованию','Сцена 3']);
 assert.deepEqual(marks.map(m=>text.slice(m.start,m.end).trim()),['* * *','*** Интерлюдия ***','***Конец интерлюдии***','---']);
 assert.equal(manuscriptBoundaries('Проза *** внутри строки.\n# Глава 2\n\nОбычный абзац.').length,0);
});
