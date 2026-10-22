// Journal structure (une ligne JSON par evenement) collecte par Alloy -> Loki.
const log = (event, fields = {}) => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    type: 'audit',
    service: 'remediation',
    event,
    ...fields
  }));
};

module.exports = { log };
