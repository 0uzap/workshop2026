const pool = require('../config/database');

// Journal d'audit :
//  - une ligne JSON sur stdout, collectée par Alloy et centralisée dans Loki
//    (investigation / fonction SOC) ;
//  - une copie en base (table auth_events), consultable dans le back-office.
// Ne jamais y écrire de mot de passe, de jeton, d'image ni de gabarit.

const auditEvent = (event, fields = {}) => {
  const entry = {
    ts: new Date().toISOString(),
    type: 'audit',
    service: 'auth-service',
    event,
    ...fields
  };

  console.log(JSON.stringify(entry));

  const { username, user_id: userId, actor_id: actorId, ip, ...detail } = fields;
  pool.query(
    `INSERT INTO auth_events (event, username, user_id, actor_id, ip, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      event,
      username ? String(username).slice(0, 100) : null,
      userId ?? null,
      actorId ?? null,
      ip ?? null,
      JSON.stringify(detail)
    ]
  ).catch((error) => console.error(`audit en base impossible : ${error.message}`));
};

// Variante liée à une requête HTTP : ajoute l'adresse IP et le navigateur
const audit = (req, event, fields = {}) =>
  auditEvent(event, {
    ip: req.ip,
    user_agent: (req.get('user-agent') || '').slice(0, 200),
    ...fields
  });

module.exports = audit;
module.exports.auditEvent = auditEvent;
