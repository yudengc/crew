import { useState, useCallback } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
}

export function useConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [resolveRef, setResolveRef] = useState<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setOptions(opts);
      setResolveRef(() => resolve);
      setIsOpen(true);
    });
  }, []);

  const handleClose = useCallback((result: boolean) => {
    setIsOpen(false);
    if (resolveRef) resolveRef(result);
  }, [resolveRef]);

  const dialog = isOpen && options && (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => handleClose(false)} />
      <div className="relative bg-[#2d2d2d] border border-gray-600 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-white mb-2">{options.title}</h3>
        <p className="text-gray-300 text-sm mb-6">{options.message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => handleClose(false)}
            className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            {options.cancelLabel || '取消'}
          </button>
          <button
            onClick={() => handleClose(true)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              options.variant === 'danger'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {options.confirmLabel || '确定'}
          </button>
        </div>
      </div>
    </div>
  );

  return { confirm, dialog };
}
