import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    const savedToken = localStorage.getItem('authToken');
    console.log("Initial token from localStorage:", savedToken);
    return savedToken;
  });
  const [loading, setLoading] = useState(true);

  // Check if user is authenticated on mount
  useEffect(() => {
    if (token) {
      console.log("Token available, fetching user profile");
      fetchUserProfile();
    } else {
      console.log("No token available, skipping profile fetch");
      setLoading(false);
    }
  }, [token]);

  const fetchUserProfile = async () => {
    try {
      console.log("Fetching user profile with token:", token);
      const storedToken = localStorage.getItem('authToken');
      console.log("Token from localStorage:", storedToken);
      
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${storedToken || token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log("Profile response status:", response.status);
      if (response.ok) {
        const userData = await response.json();
        console.log("User data:", userData);
        setUser(userData);
      } else {
        console.log("Failed to fetch user profile");
        // Token is invalid, remove it
        logout();
      }
    } catch (error) {
      console.error('Failed to fetch user profile:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Login response:", data);
        const authToken = data.access_token;
        
        console.log("Setting token:", authToken);
        // Important: First store in localStorage, then update state
        localStorage.setItem('authToken', authToken);
        setToken(authToken);
        
        // Fetch user profile after login
        await fetchUserProfile();
        
        return { success: true };
      } else {
        const errorData = await response.json();
        return { success: false, error: errorData.detail || 'Login failed' };
      }
    } catch (error) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const register = async (email, password, fullName) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          email, 
          password, 
          full_name: fullName 
        })
      });

      if (response.ok) {
        const data = await response.json();
        const authToken = data.access_token;
        
        setToken(authToken);
        localStorage.setItem('authToken', authToken);
        
        // Fetch user profile after registration
        await fetchUserProfile();
        
        return { success: true };
      } else {
        const errorData = await response.json();
        return { success: false, error: errorData.detail || 'Registration failed' };
      }
    } catch (error) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('authToken');
  };

  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};