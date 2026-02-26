import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import type { AuthResponse } from '@/types';

export function useLogin() {
  const login = useAuthStore((state) => state.login);

  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const { data } = await api.post<{ data: AuthResponse }>('/auth/login', credentials);
      return data.data;
    },
    onSuccess: (data) => {
      login(data.user, data.accessToken, data.refreshToken);
    },
  });
}

export function useRegister() {
  const login = useAuthStore((state) => state.login);

  return useMutation({
    mutationFn: async (input: { email: string; password: string; name: string }) => {
      const { data } = await api.post<{ data: AuthResponse }>('/auth/register', input);
      return data.data;
    },
    onSuccess: (data) => {
      login(data.user, data.accessToken, data.refreshToken);
    },
  });
}

export function useLogout() {
  const logout = useAuthStore((state) => state.logout);

  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
    },
    onSuccess: () => {
      logout();
    },
    onError: () => {
      logout();
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { oldPassword: string; newPassword: string }) => {
      await api.post('/auth/change-password', input);
    },
  });
}

export function useUpdateProfile() {
  const setUser = useAuthStore((state) => state.setUser);

  return useMutation({
    mutationFn: async (input: { name?: string; email?: string }) => {
      const { data } = await api.put<{ data: AuthResponse['user'] }>('/auth/profile', input);
      return data.data;
    },
    onSuccess: (data) => {
      setUser(data);
    },
  });
}
