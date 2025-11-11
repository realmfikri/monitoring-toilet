import { FormEvent, useState } from 'react';
import { buildApiUrl } from '../api';
import { useAuth } from '../auth/AuthContext';

interface LoginResponse {
  token: string;
  user: {
    email: string;
    role: 'SUPERVISOR' | 'OPERATOR';
  };
}

export default function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(buildApiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Login gagal.' }));
        const message = typeof payload?.error === 'string' ? payload.error : 'Login gagal.';
        setError(message);
        return;
      }

      const payload = (await response.json()) as LoginResponse;
      login(payload.token, payload.user);
      setEmail('');
      setPassword('');
    } catch (err) {
      console.error('Login request failed:', err);
      setError('Tidak dapat terhubung ke server. Silakan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-card">
      <h2>Masuk ke Sistem</h2>
      <form className="login-form" onSubmit={handleSubmit}>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          required
          placeholder="supervisor@example.com"
        />

        <label htmlFor="login-password">Kata Sandi</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          required
        />

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Masuk...' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
