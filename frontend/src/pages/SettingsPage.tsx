import { useState } from 'react';
import { Card, Button } from '@/components/ui';
import { useAuthStore } from '@/store/auth.store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { RetailerType } from '@/types';
import { useUpdateProfile, useChangePassword, useAcknowledgeAllAlerts } from '@/hooks';
import toast from 'react-hot-toast';

interface Credential {
  id: string;
  retailer: RetailerType;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export function SettingsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  // ── Profile edit state ─────────────────────────────────
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: user?.name ?? '', email: user?.email ?? '' });
  const { mutate: updateProfile, isPending: updatingProfile } = useUpdateProfile();

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile(profileForm, {
      onSuccess: () => {
        toast.success('Profile updated');
        setEditingProfile(false);
      },
      onError: (err: Error) => {
        toast.error(err.message ?? 'Failed to update profile');
      },
    });
  };

  // ── Change password state ──────────────────────────────
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const { mutate: changePassword, isPending: changingPassword } = useChangePassword();

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirm) {
      toast.error('New passwords do not match');
      return;
    }
    changePassword(
      { oldPassword: passwordForm.oldPassword, newPassword: passwordForm.newPassword },
      {
        onSuccess: () => {
          toast.success('Password changed successfully');
          setShowPasswordModal(false);
          setPasswordForm({ oldPassword: '', newPassword: '', confirm: '' });
        },
        onError: (err: Error) => {
          toast.error(err.message ?? 'Failed to change password');
        },
      },
    );
  };

  // ── Credentials ──────────────────────────────────────
  const [showAddCredential, setShowAddCredential] = useState(false);
  const [credentialForm, setCredentialForm] = useState({
    retailer: RetailerType.AMAZON,
    username: '',
    password: '',
  });

  const { data: credentials, isLoading: credentialsLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: async () => {
      const resp = await api.get<{ data: Credential[] }>('/api/v1/credentials');
      return resp.data.data;
    },
  });

  const addCredential = useMutation({
    mutationFn: async (data: { retailer: RetailerType; username: string; password: string }) => {
      const resp = await api.post('/api/v1/credentials', data);
      return resp.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      toast.success('Credential added successfully');
      setShowAddCredential(false);
      setCredentialForm({ retailer: RetailerType.AMAZON, username: '', password: '' });
    },
    onError: (error: Error) => {
      toast.error(error.message ?? 'Failed to add credential');
    },
  });

  const deleteCredential = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/credentials/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      toast.success('Credential deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message ?? 'Failed to delete credential');
    },
  });

  const handleAddCredential = (e: React.FormEvent) => {
    e.preventDefault();
    addCredential.mutate(credentialForm);
  };

  // ── Danger zone ──────────────────────────────────────
  const { mutate: acknowledgeAll, isPending: clearingAlerts } = useAcknowledgeAllAlerts();

  const clearCheckouts = useMutation({
    mutationFn: async () => {
      await api.delete('/checkouts/my');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkouts'] });
      queryClient.invalidateQueries({ queryKey: ['checkout-stats'] });
      toast.success('Checkout history cleared');
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to clear checkout history');
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 mt-1">Manage your account and retailer credentials</p>
      </div>

      {/* Account Information */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Account Information</h3>
          {!editingProfile && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setProfileForm({ name: user?.name ?? '', email: user?.email ?? '' });
                setEditingProfile(true);
              }}
            >
              Edit Profile
            </Button>
          )}
        </div>

        {editingProfile ? (
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                className="input"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                className="input"
                required
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button type="submit" loading={updatingProfile}>
                Save Changes
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditingProfile(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label">Name</label>
              <p className="text-white">{user?.name ?? <span className="text-gray-500 italic">Not set</span>}</p>
            </div>
            <div>
              <label className="label">Email</label>
              <p className="text-white">{user?.email ?? '-'}</p>
            </div>
            <div>
              <label className="label">Role</label>
              <p className="text-white capitalize">{user?.role?.toLowerCase() ?? '-'}</p>
            </div>
            <div className="pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowPasswordModal(true)}
              >
                Change Password
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Retailer Credentials */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Retailer Credentials</h3>
          <Button size="sm" onClick={() => setShowAddCredential(true)}>
            Add Credential
          </Button>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          Credentials are encrypted at rest and used for automated checkout.
        </p>

        {credentialsLoading ? (
          <p className="text-gray-400">Loading...</p>
        ) : !credentials || credentials.length === 0 ? (
          <p className="text-gray-400">No credentials configured</p>
        ) : (
          <div className="space-y-3">
            {credentials.map((cred: Credential) => (
              <div
                key={cred.id}
                className="flex items-center justify-between p-3 bg-gray-750 rounded-lg"
              >
                <div>
                  <p className="text-white font-medium capitalize">{cred.retailer.toLowerCase()}</p>
                  <p className="text-sm text-gray-400">{cred.username}</p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (confirm('Delete this credential?')) {
                      deleteCredential.mutate(cred.id);
                    }
                  }}
                  loading={deleteCredential.isPending}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add Credential Modal */}
      {showAddCredential && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">Add Retailer Credential</h3>
            <form onSubmit={handleAddCredential} className="space-y-4">
              <div>
                <label className="label">Retailer</label>
                <select
                  value={credentialForm.retailer}
                  onChange={(e) =>
                    setCredentialForm({ ...credentialForm, retailer: e.target.value as RetailerType })
                  }
                  className="input"
                  required
                >
                  {Object.values(RetailerType).map((retailer) => (
                    <option key={retailer} value={retailer}>
                      {retailer.charAt(0).toUpperCase() + retailer.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Username / Email</label>
                <input
                  type="text"
                  value={credentialForm.username}
                  onChange={(e) =>
                    setCredentialForm({ ...credentialForm, username: e.target.value })
                  }
                  className="input"
                  placeholder="user@example.com"
                  required
                />
              </div>

              <div>
                <label className="label">Password</label>
                <input
                  type="password"
                  value={credentialForm.password}
                  onChange={(e) =>
                    setCredentialForm({ ...credentialForm, password: e.target.value })
                  }
                  className="input"
                  placeholder="••••••••"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowAddCredential(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={addCredential.isPending}>
                  Add Credential
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">Change Password</h3>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="label">Current Password</label>
                <input
                  type="password"
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                  className="input"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div>
                <label className="label">New Password</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="input"
                  placeholder="••••••••"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="label">Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                  className="input"
                  placeholder="••••••••"
                  minLength={8}
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordForm({ oldPassword: '', newPassword: '', confirm: '' });
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={changingPassword}>
                  Change Password
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Danger Zone */}
      <Card className="border border-red-500/20">
        <h3 className="text-lg font-semibold text-red-400 mb-4">Danger Zone</h3>
        <p className="text-sm text-gray-400 mb-4">
          These actions are irreversible. Please proceed with caution.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="danger"
            loading={clearCheckouts.isPending}
            onClick={() => {
              if (confirm('Delete all your checkout attempts? This cannot be undone.')) {
                clearCheckouts.mutate();
              }
            }}
          >
            Clear Checkout History
          </Button>
          <Button
            variant="danger"
            loading={clearingAlerts}
            onClick={() => {
              if (confirm('Acknowledge all alerts? This cannot be undone.')) {
                acknowledgeAll(undefined, {
                  onSuccess: (msg) => {
                    queryClient.invalidateQueries({ queryKey: ['alerts'] });
                    toast.success(typeof msg === 'string' ? msg : 'All alerts cleared');
                  },
                  onError: (err: Error) => {
                    toast.error(err.message ?? 'Failed to clear alerts');
                  },
                });
              }
            }}
          >
            Clear All Alerts
          </Button>
        </div>
      </Card>
    </div>
  );
}
