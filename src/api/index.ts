export async function api(route: string, data?: any) {
 const r=await fetch(`/api/${route}`,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Writer-Client':'1'},body:JSON.stringify(data)});
 const value=await r.json();if(!r.ok)throw new Error(value.error||'Ошибка запроса');return value;
}
