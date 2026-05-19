import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { API_BASE_URL, resolveMediaUrl } from '../../config'

function ProfileSettings() {
    const navigate = useNavigate();
    const user = useStore(state => state.user);
    const setUser = useStore(state => state.setUser);
    const token = useStore.getState().token;
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({});
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);

    useEffect(() => {
        const fetchProfile = async () => {
            const activeToken = token || localStorage.getItem('token');
            if (!activeToken || activeToken === 'null' || activeToken === 'undefined') {
                setLoading(false);
                return;
            }
            try {
                const res = await fetch(`${API_BASE_URL}/user/profile`, {
                    headers: { 'Authorization': `Bearer ${activeToken}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setProfile(data);
                    setForm(data);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchProfile();
    }, [token]);

    const handleFileChange = e => {
        const file = e.target.files[0];
        setForm(prev => ({ ...prev, file }));
    };

    const handleSubmit = async e => {
        e.preventDefault();
        setMessage('');
        setError('');
        setSaving(true);
        const formData = new FormData();
        Object.keys(form).forEach(k => {
            if (form[k] !== null && form[k] !== undefined) {
                formData.append(k, form[k]);
            }
        });
        try {
            const res = await fetch(`${API_BASE_URL}/user/profile`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (res.ok) {
                const updated = await res.json();
                setUser(updated, token);
                setProfile(updated);
                setForm(updated);
                setMessage('Profile updated successfully');
            } else {
                const errData = await res.json().catch(() => null);
                setError(errData?.error || 'Failed to update profile');
            }
        } catch (e) {
            console.error(e);
            setError('Connection error while updating profile');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div>Loading...</div>;
    if (!profile) return <div>Error loading profile</div>;

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Account Settings</h2>
            {message && <div className="text-green-600 mb-2">{message}</div>}
            {error && <div className="text-red-600 mb-2">{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                    {profile.profile_image && !imageFailed ? (
                        <img
                            src={resolveMediaUrl(profile.profile_image)}
                            className="w-16 h-16 rounded-full object-cover"
                            alt="Profile"
                            onError={() => setImageFailed(true)}
                        />
                    ) : (
                        <div className="w-16 h-16 bg-gray-200 rounded-full" />
                    )}
                    <input type="file" accept="image/*" onChange={handleFileChange} />
                </div>
                <input
                    type="text"
                    placeholder="Full Name"
                    value={form.name || ''}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    className="input"
                />
                <input type="email" value={profile.email} disabled className="input bg-gray-100" />
                <input
                    type="text"
                    placeholder="Phone"
                    value={form.phone || ''}
                    onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
                    className="input"
                />
                <select
                    value={form.gender || ''}
                    onChange={e => setForm(prev => ({ ...prev, gender: e.target.value }))}
                    className="input"
                >
                    <option value="">Select Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                </select>
                <input
                    type="date"
                    value={form.date_of_birth || ''}
                    onChange={e => setForm(prev => ({ ...prev, date_of_birth: e.target.value }))}
                    className="input"
                />
                <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold">About</label>
                    <textarea
                        placeholder="Tell us a bit about you (optional)"
                        value={form.about || ''}
                        onChange={e => setForm(prev => ({ ...prev, about: e.target.value }))}
                        className="input min-h-[110px] resize-y"
                        maxLength={500}
                    />
                    <div className="text-xs opacity-60 text-right">
                        {(form.about || '').length}/500
                    </div>
                </div>
                <button className="btn-primary" disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </form>
        </div>
    )
}

export default ProfileSettings
