import * as SecureStore from 'expo-secure-store';

export const getSecureItem = SecureStore.getItemAsync;
export const setSecureItem = SecureStore.setItemAsync;
export const deleteSecureItem = SecureStore.deleteItemAsync;
