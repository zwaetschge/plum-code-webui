import React from 'react';
import { createRoot } from 'react-dom/client';
import { useAuthStore } from '../../src/stores/authStore';
import { OfficeConnectPage } from '../../src/pages/OfficeConnectPage';
import '../../src/index.css';
useAuthStore.setState({
  token: 'ordinary-office-fixture-jwt',
  user: { id: 'office-alice', email: 'office-alice@fixture.invalid' } as never,
});
(window as unknown as { __changeOwner: () => void }).__changeOwner = () =>
  useAuthStore.setState({
    token: 'ordinary-bob-fixture-jwt',
    user: { id: 'office-bob', email: 'office-bob@fixture.invalid' } as never,
  });
createRoot(document.getElementById('root')!).render(<OfficeConnectPage />);
