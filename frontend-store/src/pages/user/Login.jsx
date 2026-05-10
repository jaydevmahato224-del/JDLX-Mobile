import toast from "react-hot-toast"
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { API_BASE_URL } from '../../config'

function Login() {
    const navigate = useNavigate();
    const setUser = useStore(state => state.setUser);
    const backendOrigin = API_BASE_URL
        .replace(/\/api\/?$/, '');
    const oauthLoginUrl = `${backendOrigin}/login/google`;

    const handleSuccess = async (credentialResponse) => {
        try {
            const res = await fetch(`${API_BASE_URL}/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: credentialResponse.credential })
            });

            if (!res.ok) throw new Error("Auth failed");

            const data = await res.json();

            // data contains { user: {...}, token: "..." }
            setUser(data.user, data.token);
            navigate('/'); // redirect home
        } catch (error) {
            console.error('Google Login Error:', error);
            toast.error("Login failed. Please try again.");
        }
    };

    const handleError = () => {
        console.error('Google Login Failed');
    };

    return (
        <div className="container-standard flex flex-col items-center justify-center min-h-[70vh]">
            <div className="glass-card w-full max-w-sm p-8 text-center flex flex-col items-center gap-6">
                <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-2 shadow-inner">
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" /></svg>
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Welcome to JDLX Mobile</h1>
                    <p className="text-gray-500 text-sm mt-2">Sign in for a better experience and continue your shopping.</p>
                </div>

                <div className="w-full mt-4 flex justify-center">
                    <a
                        href={oauthLoginUrl}
                        className="flex items-center justify-center gap-3 w-full border border-gray-300 rounded-full py-3 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors bg-white shadow-sm"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Continue with Google
                    </a>
                </div>



                <p className="text-xs text-gray-400 mt-4 leading-relaxed">
                    By continuing, you agree to our Terms of Service and Privacy Policy.
                </p>
            </div>
        </div>
    )
}

export default Login
