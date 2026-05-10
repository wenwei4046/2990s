import { useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '@2990s/design-system';
import { CartContents } from '../components/CartContents';
import { Topbar } from '../components/Topbar';
import styles from './Cart.module.css';

export const Cart = () => {
  const navigate = useNavigate();
  return (
    <>
      <Topbar step="cart" />
      <main className={styles.shell}>
        <header className={styles.header}>
          <IconButton
            icon={<ArrowLeft size={20} strokeWidth={1.75} />}
            aria-label="Back"
            onClick={() => navigate('/catalog')}
          />
          <h1 className={styles.heading}>Cart</h1>
        </header>
        <CartContents variant="page" onContinue={() => navigate('/handover')} />
      </main>
    </>
  );
};
