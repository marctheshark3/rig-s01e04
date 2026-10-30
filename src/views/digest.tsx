import type { NightDigest } from '../digest/types.js';

const missing = '—';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p class="mute">
        {digest.rows.length} jobs · {digest.counts.ok} ok · {digest.counts.retry} retries ·{' '}
        {digest.counts.fail} failures · {digest.badLines} bad line{digest.badLines === 1 ? '' : 's'}
      </p>
      {digest.rows.length === 0 ? (
        <p>nothing ran</p>
      ) : (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">job</th>
                <th scope="col">owner</th>
                <th scope="col">runs</th>
                <th scope="col">retries</th>
                <th scope="col">last status</th>
                <th scope="col">last error</th>
                <th scope="col">first time</th>
                <th scope="col">last time</th>
              </tr>
            </thead>
            <tbody>
              {digest.rows.map((row) => {
                const warning = row.retries >= 3 || row.lastStatus === 'fail';
                return (
                  <tr class={warning ? 'warn' : undefined}>
                    <th scope="row">{row.job}</th>
                    <td>{row.owner ?? missing}</td>
                    <td>{row.runs}</td>
                    <td>{row.retries}</td>
                    <td>{row.lastStatus}</td>
                    <td>{row.lastError ?? missing}</td>
                    <td>{row.firstAt}</td>
                    <td>{row.lastAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
