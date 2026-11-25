import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getErrorMessage } from '../api/client';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Logo, BRAND_NAME } from '../components/ui/Logo';
import { Loader } from '../components/ui/Loader';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [entering, setEntering] = useState(false);

  const onChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setErrors((er) => ({ ...er, [e.target.name]: undefined }));
  };

  const validate = () => {
    const er = {};
    if (!form.email.trim()) er.email = 'Email is required';
    else if (!EMAIL_RE.test(form.email.trim())) er.email = 'Enter a valid email address';
    if (!form.password) er.password = 'Password is required';
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const user = await login(form.email.trim(), form.password);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}!`, 'You have signed in successfully.');
      setEntering(true);
      const to = location.state?.from?.pathname || '/';
      setTimeout(() => navigate(to, { replace: true }), 700);
    } catch (err) {
      toast.error('Sign in failed', getErrorMessage(err));
      setSubmitting(false);
    }
  };

  if (entering) return <Loader fullscreen label="Preparing your workspace…" />;

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit} noValidate>
        <div className="login__head">
          <Logo size={72} />
          <h1>{BRAND_NAME}</h1>
          <p>Sign in to manage your inventory and orders.</p>
        </div>

        <Input
          label="Email"
          name="email"
          type="email"
          icon={Mail}
          placeholder="you@fifthseasonsdecor.com"
          autoComplete="email"
          autoFocus
          value={form.email}
          onChange={onChange}
          error={errors.email}
        />
        <Input
          label="Password"
          name="password"
          type="password"
          icon={Lock}
          placeholder="Enter your password"
          autoComplete="current-password"
          value={form.password}
          onChange={onChange}
          error={errors.password}
        />

        <Button type="submit" size="lg" block loading={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>
    </div>
  );
}
