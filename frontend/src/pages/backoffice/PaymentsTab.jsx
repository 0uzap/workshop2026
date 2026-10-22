import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

export default function PaymentsTab({ token, me }) {
  const [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState('10.00');
  const [message, setMessage] = useState(null);

  const load = useCallback(() => {
    api('/api/payments', { token })
      .then(setPayments)
      .catch((err) => setMessage({ error: true, text: err.message }));
  }, [token]);

  useEffect(load, [load]);

  const pay = async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/payments', {
        method: 'POST',
        token,
        body: { amount: Number(amount), currency: 'EUR' }
      });
      setMessage({ text: `Transaction ${res.status} — ${res.transaction_id}` });
      load();
    } catch (err) {
      setMessage({ error: true, text: err.message });
    }
  };

  return (
    <div className="space-y-4">
      {me.permissions.includes('payments:write') && (
        <form onSubmit={pay} className="flex gap-2">
          <input
            type="number"
            min="0.01"
            step="0.01"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold hover:bg-emerald-500">
            Transaction de test (EUR)
          </button>
        </form>
      )}

      {message && (
        <p className={`text-sm ${message.error ? 'text-red-400' : 'text-emerald-300'}`}>{message.text}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-400">
            <tr>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Transaction</th>
              <th className="py-2 pr-3">Montant</th>
              <th className="py-2">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {payments.slice(0, 50).map((p) => (
              <tr key={p.transaction_id}>
                <td className="py-2 pr-3 text-slate-400">{new Date(p.created_at).toLocaleString('fr-FR')}</td>
                <td className="py-2 pr-3 font-mono text-xs">{p.transaction_id}</td>
                <td className="py-2 pr-3">{Number(p.amount).toFixed(2)} {p.currency}</td>
                <td className="py-2">{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
