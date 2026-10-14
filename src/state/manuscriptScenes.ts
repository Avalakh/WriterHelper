export type SceneBoundary={start:number;end:number;label:string};
export function manuscriptBoundaries(text:string):SceneBoundary[]{
 const result:SceneBoundary[]=[];let scene=1;
 const pattern=/^[\t ]*(?:(?:\*[\t ]*){3,}|-{3,}|_{3,}|\*{3}[\t ]*(?:Конец интерлюдии|Интерлюдия)[\t ]*\*{3})[\t ]*\r?$/gimu;
 for(const match of text.matchAll(pattern)){
  const label=/Конец интерлюдии/iu.test(match[0])?'Возвращение к основному повествованию':/Интерлюдия/iu.test(match[0])?'Интерлюдия':`Сцена ${++scene}`;
  result.push({start:match.index!,end:match.index!+match[0].length,label});
 }
 return result;
}
