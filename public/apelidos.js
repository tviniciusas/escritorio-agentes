/* apelidos.js — cada agente ganha um nome curto de gente (brasileiro ou americano) para aparecer na sala.
 * O nome sai do hash do id (o mesmo agente tende a ganhar sempre o mesmo) e nunca se repete entre os
 * agentes presentes; o nome de quem saiu volta para a fila.
 */
const BR = ['Ana', 'Caio', 'Bia', 'Enzo', 'Duda', 'Léo', 'Gabi', 'Davi', 'Malu', 'Téo', 'Nina', 'Rafa', 'Lua', 'Vini', 'Júlia', 'Gael',
  'Clara', 'Bento', 'Lara', 'Igor', 'Maju', 'Pedro', 'Tati', 'Rui', 'Iza', 'Guto', 'Lia', 'João'];
const US = ['Brad', 'Alison', 'Jake', 'Emma', 'Ryan', 'Chloe', 'Tyler', 'Megan', 'Kyle', 'Ashley', 'Josh', 'Hannah', 'Logan', 'Mia',
  'Ethan', 'Zoe', 'Mason', 'Ava', 'Chase', 'Riley', 'Dylan', 'Grace', 'Owen', 'Lily', 'Jack', 'Ruby', 'Noah', 'Sadie'];
const NOMES = BR.flatMap((n, i) => [n, US[i]]);

const porId = new Map();    // id -> apelido
const dono = new Map();     // apelido -> id

function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function apelido(id) {
  let n = porId.get(id);
  if (n) return n;
  const h = hash(String(id));
  for (let i = 0; i < NOMES.length; i++) {
    const c = NOMES[(h + i) % NOMES.length];
    if (!dono.has(c)) { n = c; break; }
  }
  if (!n) n = NOMES[h % NOMES.length] + ' ' + (2 + (h % 8));   // sala lotada: "Ana 3"
  porId.set(id, n); dono.set(n, id);
  return n;
}

/** Devolve à fila os nomes de quem não está mais na sala. */
export function liberar(vivos) {
  for (const [id, n] of porId) if (!vivos.has(id)) { porId.delete(id); if (dono.get(n) === id) dono.delete(n); }
}
