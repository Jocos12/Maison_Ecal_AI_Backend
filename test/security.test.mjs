// Tests des protections de sécurité. Lancer : npm test (outil de test intégré à Node, sans dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin, isManagerOrAdmin, requireAdmin, requireManager } from '../src/middleware/roles.js';
import { requireActiveUser } from '../src/middleware/auth.js';
import { escapeRegex, pickKnown, stripUnsafeKeys } from '../src/utils/requestSafety.js';
import { contentDisposition, contentTypeFor, validateUpload } from '../src/utils/uploadPolicy.js';

/** Simule (req, res, next) et renvoie le code HTTP obtenu, ou 'next' si la requête passe. */
function run(middleware, req) {
  let status = 'next';
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  middleware(req, res, () => {});
  return status;
}

test('rôles : Admin, Manager, Analyste', () => {
  assert.equal(isAdmin({ role: 'Admin' }), true);
  assert.equal(isAdmin({ role: 'admin' }), true);
  assert.equal(isAdmin({ role: 'Manager' }), false);
  assert.equal(isAdmin(null), false);
  assert.equal(isManagerOrAdmin({ role: 'Manager' }), true);
  assert.equal(isManagerOrAdmin({ role: 'Analyste' }), false);
});

test('requireAdmin / requireManager bloquent les rôles insuffisants', () => {
  assert.equal(run(requireAdmin, { user: { role: 'Admin' } }), 'next');
  assert.equal(run(requireAdmin, { user: { role: 'Manager' } }), 403);
  assert.equal(run(requireAdmin, {}), 403);
  assert.equal(run(requireManager, { user: { role: 'Manager' } }), 'next');
  assert.equal(run(requireManager, { user: { role: 'Analyste' } }), 403);
});

test('requireActiveUser : compte supprimé, non approuvé, rôle relu en base', () => {
  assert.equal(run(requireActiveUser, { user: null }), 401);
  assert.equal(run(requireActiveUser, { user: { role: 'Analyste', isApproved: false } }), 403);
  const req = { userRole: 'Admin', user: { role: 'Analyste', email: 'a@x', isApproved: true } };
  assert.equal(run(requireActiveUser, req), 'next');
  assert.equal(req.userRole, 'Analyste', 'le rôle du jeton est remplacé par celui de la base');
});

test('escapeRegex : un texte saisi ne peut pas devenir une expression régulière', () => {
  const re = new RegExp(escapeRegex('(a+)+$'), 'i');
  assert.equal(re.test('xx(a+)+$yy'), true);
  assert.equal(re.test('aaaa'), false);
  assert.equal(escapeRegex('x'.repeat(200)).length, 80);
});

test('stripUnsafeKeys / pickKnown : opérateurs MongoDB et champs inconnus retirés', () => {
  const body = stripUnsafeKeys({ notes: 'ok', $set: { role: 'Admin' }, 'a.b': 1, _id: 'x' }, ['_id']);
  assert.deepEqual(body, { notes: 'ok' });
  assert.deepEqual(pickKnown({ email: 'e', evil: 1 }, ['email', 'phone']), { email: 'e' });
});

test('validateUpload : type, taille et contenu réel du fichier', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
  assert.equal(validateUpload({ fileName: 'cv.pdf', buffer: pdf }), null);
  assert.match(validateUpload({ fileName: 'script.exe', buffer: pdf }), /non accepté/);
  assert.match(validateUpload({ fileName: 'faux.pdf', buffer: Buffer.from('MZ binaire') }), /ne correspond pas/);
  assert.match(validateUpload({ fileName: 'gros.pdf', buffer: pdf, maxBytes: 10 }), /trop volumineux/);
  assert.match(validateUpload({ fileName: 'vide.pdf', buffer: Buffer.alloc(0) }), /vide/);
});

test('contentDisposition : nom de fichier sans guillemets ni retour à la ligne', () => {
  const header = contentDisposition('CV "Élodie"\r\nX.pdf');
  assert.doesNotMatch(header, /[\r\n]/);
  assert.match(header, /^attachment; filename="CV Elodie.?X\.pdf"; filename\*=UTF-8''/);
  assert.equal(contentTypeFor('lettre.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});
