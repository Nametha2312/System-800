import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button } from '@/components/ui';
import { useCreateSKU } from '@/hooks';
import { RetailerType } from '@/types';
import toast from 'react-hot-toast';

export function NewSKUPage() {
  const navigate = useNavigate();
  const { mutate: createSKU, isPending } = useCreateSKU();

  const [form, setForm] = useState({
    productName: '',
    productUrl: '',
    productId: '',
    retailer: RetailerType.AMAZON,
    targetPrice: '',
    autoCheckoutEnabled: false,
    pollingIntervalMs: 60000,
    metadata: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      productName: form.productName,
      productUrl: form.productUrl,
      productId: form.productId || form.productUrl,
      retailer: form.retailer,
      targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : undefined,
      autoCheckoutEnabled: form.autoCheckoutEnabled,
      pollingIntervalMs: form.pollingIntervalMs,
      metadata: form.metadata ? JSON.parse(form.metadata) : undefined,
    };

    createSKU(payload, {
      onSuccess: () => {
        toast.success('SKU created successfully');
        navigate('/skus');
      },
      onError: (error) => {
        toast.error(error.message ?? 'Failed to create SKU');
      },
    });
  };

  const detectRetailer = (url: string): RetailerType | null => {
    const lower = url.toLowerCase();
    if (lower.includes('amazon.')) return RetailerType.AMAZON;
    if (lower.includes('bestbuy.')) return RetailerType.BESTBUY;
    if (lower.includes('walmart.')) return RetailerType.WALMART;
    if (lower.includes('target.')) return RetailerType.TARGET;
    if (lower.includes('newegg.')) return RetailerType.NEWEGG;
    if (lower.includes('pokemoncenter.')) return RetailerType.POKEMON_CENTER;
    return null;
  };

  const handleUrlChange = (url: string) => {
    setForm({ ...form, productUrl: url });
    const detected = detectRetailer(url);
    if (detected) {
      setForm((prev) => ({ ...prev, productUrl: url, retailer: detected }));
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Add New SKU</h1>
        <p className="text-gray-400 mt-1">Configure a new product to monitor</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Product Information</h3>

            <div>
              <label className="label">Product Name *</label>
              <input
                type="text"
                value={form.productName}
                onChange={(e) => setForm({ ...form, productName: e.target.value })}
                className="input"
                placeholder="PlayStation 5 Console"
                required
              />
            </div>

            <div>
              <label className="label">Product URL *</label>
              <input
                type="url"
                value={form.productUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                className="input"
                placeholder="https://www.amazon.com/dp/..."
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                The retailer will be auto-detected from the URL
              </p>
            </div>

            <div>
              <label className="label">Retailer *</label>
              <select
                value={form.retailer}
                onChange={(e) => setForm({ ...form, retailer: e.target.value as RetailerType })}
                className="input"
                required
              >
                {Object.values(RetailerType).map((retailer) => (
                  <option key={retailer} value={retailer}>
                    {retailer.charAt(0).toUpperCase() + retailer.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Monitoring Settings */}
          <div className="space-y-4 pt-4 border-t border-gray-700">
            <h3 className="text-lg font-semibold text-white">Monitoring Settings</h3>

            <div>
              <label className="label">Target Price (optional)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.targetPrice}
                onChange={(e) => setForm({ ...form, targetPrice: e.target.value })}
                className="input"
                placeholder="499.99"
              />
              <p className="text-xs text-gray-500 mt-1">
                Receive alerts when price drops to or below this amount
              </p>
            </div>

            <div>
              <label className="label">Check Interval (seconds)</label>
              <input
                type="number"
                min="30"
                max="3600"
                value={form.pollingIntervalMs / 1000}
                onChange={(e) => setForm({ ...form, pollingIntervalMs: parseInt(e.target.value) * 1000 })}
                className="input"
              />
              <p className="text-xs text-gray-500 mt-1">
                How often to check this product (min: 30s, max: 3600s)
              </p>
            </div>

          </div>

          {/* Automation */}
          <div className="space-y-4 pt-4 border-t border-gray-700">
            <h3 className="text-lg font-semibold text-white">Automation</h3>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoCheckoutEnabled}
                onChange={(e) => setForm({ ...form, autoCheckoutEnabled: e.target.checked })}
                className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <p className="text-white font-medium">Enable Auto-Checkout</p>
                <p className="text-sm text-gray-400">
                  Automatically attempt to purchase when stock is available
                </p>
              </div>
            </label>

            {form.autoCheckoutEnabled && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-sm text-yellow-400">
                  Warning: Auto-checkout will attempt real purchases. Make sure you have valid
                  credentials configured for {form.retailer}.
                </p>
              </div>
            )}
          </div>

          {/* Advanced */}
          <div className="space-y-4 pt-4 border-t border-gray-700">
            <h3 className="text-lg font-semibold text-white">Advanced (Optional)</h3>

            <div>
              <label className="label">Custom Metadata (JSON)</label>
              <textarea
                value={form.metadata}
                onChange={(e) => setForm({ ...form, metadata: e.target.value })}
                className="input min-h-[80px] font-mono text-sm"
                placeholder='{"variant": "disc", "color": "white"}'
              />
              <p className="text-xs text-gray-500 mt-1">
                Optional JSON metadata for custom tracking
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button type="button" variant="secondary" onClick={() => navigate('/skus')}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending}>
              Create SKU
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
