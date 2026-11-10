import { useState, useEffect, useCallback } from 'react';
import { Folder, Plus, Trash2, Edit2, Check, X, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

interface SessionCategoriesProps {
  selectedCategory: string | null;
  onCategorySelect: (categoryId: string | null) => void;
  className?: string;
}

interface ApiCategoriesResponse {
  success: boolean;
  data?: Category[];
}

interface ApiCategoryResponse {
  success: boolean;
  data?: Category;
}

const COLORS = [
  { name: 'blue', value: '#3b82f6' },
  { name: 'green', value: '#22c55e' },
  { name: 'purple', value: '#a855f7' },
  { name: 'orange', value: '#f97316' },
  { name: 'pink', value: '#ec4899' },
  { name: 'yellow', value: '#eab308' },
  { name: 'red', value: '#ef4444' },
  { name: 'teal', value: '#14b8a6' },
];

export function SessionCategories({
  selectedCategory,
  onCategorySelect,
  className,
}: SessionCategoriesProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newCategoryDialog, setNewCategoryDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('blue');

  const fetchCategories = useCallback(async () => {
    try {
      const response = await api.get<ApiCategoriesResponse>('/api/categories');
      if (response.data.success && response.data.data) {
        setCategories(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const createCategory = async () => {
    if (!newName.trim()) return;

    setLoading(true);
    try {
      const response = await api.post<ApiCategoryResponse>('/api/categories', {
        name: newName.trim(),
        color: newColor,
      });
      if (response.data.success && response.data.data) {
        setCategories([...categories, response.data.data]);
        setNewName('');
        setNewColor('blue');
        setNewCategoryDialog(false);
      }
    } catch (error) {
      console.error('Failed to create category:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateCategory = async (id: string, name: string) => {
    if (!name.trim()) return;

    try {
      const response = await api.patch<ApiCategoryResponse>(`/api/categories/${id}`, {
        name: name.trim(),
      });
      if (response.data.success && response.data.data) {
        setCategories(categories.map((c) => (c.id === id ? response.data.data! : c)));
      }
    } catch (error) {
      console.error('Failed to update category:', error);
    }
    setEditingId(null);
  };

  const updateCategoryColor = async (id: string, color: string) => {
    try {
      const response = await api.patch<ApiCategoryResponse>(`/api/categories/${id}`, { color });
      if (response.data.success && response.data.data) {
        setCategories(categories.map((c) => (c.id === id ? response.data.data! : c)));
      }
    } catch (error) {
      console.error('Failed to update category color:', error);
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      await api.delete(`/api/categories/${id}`);
      setCategories(categories.filter((c) => c.id !== id));
      if (selectedCategory === id) {
        onCategorySelect(null);
      }
    } catch (error) {
      console.error('Failed to delete category:', error);
    }
  };

  const getColorValue = (colorName: string) => {
    return COLORS.find((c) => c.name === colorName)?.value ?? COLORS[0]?.value ?? '#3b82f6';
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">Categories</span>
        <Button
          aria-label="Kategorie hinzufügen"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setNewCategoryDialog(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Categories list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* All sessions */}
          <button
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
              selectedCategory === null
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted text-muted-foreground'
            )}
            onClick={() => onCategorySelect(null)}
          >
            <Folder className="h-4 w-4" />
            <span>All Sessions</span>
          </button>

          {/* Category items */}
          {categories.map((category) => (
            <div
              key={category.id}
              className={cn(
                'group flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors',
                selectedCategory === category.id ? 'bg-primary/10' : 'hover:bg-muted'
              )}
            >
              {editingId === category.id ? (
                <div className="flex-1 flex items-center gap-1">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-6 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateCategory(category.id, editName);
                      } else if (e.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                  />
                  <Button
                    aria-label="Namen speichern"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => updateCategory(category.id, editName)}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    aria-label="Umbenennen abbrechen"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <>
                  <button
                    className="flex-1 flex items-center gap-2 text-sm text-left"
                    onClick={() => onCategorySelect(category.id)}
                  >
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: getColorValue(category.color) }}
                    />
                    <span className="truncate">{category.name}</span>
                  </button>

                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Color picker */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label="Farbe wählen"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                        >
                          <Palette className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <div className="grid grid-cols-4 gap-1 p-2">
                          {COLORS.map((color) => (
                            <button
                              key={color.name}
                              className={cn(
                                'h-6 w-6 rounded-full border-2',
                                category.color === color.name
                                  ? 'border-foreground'
                                  : 'border-transparent'
                              )}
                              style={{ backgroundColor: color.value }}
                              onClick={() => updateCategoryColor(category.id, color.name)}
                            />
                          ))}
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Edit */}
                    <Button
                      aria-label="Kategorie umbenennen"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        setEditingId(category.id);
                        setEditName(category.name);
                      }}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>

                    {/* Delete */}
                    <Button
                      aria-label="Kategorie löschen"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      onClick={() => deleteCategory(category.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}

          {categories.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No categories yet</p>
          )}
        </div>
      </ScrollArea>

      {/* New category dialog */}
      <Dialog open={newCategoryDialog} onOpenChange={setNewCategoryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Category name..."
                className="mt-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    createCategory();
                  }
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <div className="grid grid-cols-8 gap-2 mt-2">
                {COLORS.map((color) => (
                  <button
                    key={color.name}
                    className={cn(
                      'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                      newColor === color.name ? 'border-foreground' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color.value }}
                    onClick={() => setNewColor(color.name)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCategoryDialog(false)}>
              Cancel
            </Button>
            <Button onClick={createCategory} disabled={!newName.trim() || loading}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Category selector for session assignment
interface CategorySelectorProps {
  sessionId: string;
  currentCategory: string | null;
  onCategoryChange?: (categoryId: string | null) => void;
}

export function CategorySelector({
  sessionId,
  currentCategory,
  onCategoryChange,
}: CategorySelectorProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await api.get<ApiCategoriesResponse>('/api/categories');
        if (response.data.success && response.data.data) {
          setCategories(response.data.data);
        }
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      }
    };
    fetchCategories();
  }, []);

  const assignCategory = async (categoryId: string | null) => {
    setLoading(true);
    try {
      await api.patch(`/api/sessions/${sessionId}/category`, {
        categoryId,
      });
      onCategoryChange?.(categoryId);
    } catch (error) {
      console.error('Failed to assign category:', error);
    } finally {
      setLoading(false);
    }
  };

  const getColorValue = (colorName: string) => {
    return COLORS.find((c) => c.name === colorName)?.value ?? COLORS[0]?.value ?? '#3b82f6';
  };

  const currentCategoryData = categories.find((c) => c.id === currentCategory);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1" disabled={loading}>
          {currentCategory && currentCategoryData ? (
            <>
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: getColorValue(currentCategoryData.color),
                }}
              />
              <span className="text-xs">{currentCategoryData.name}</span>
            </>
          ) : (
            <>
              <Folder className="h-3 w-3" />
              <span className="text-xs">Uncategorized</span>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => assignCategory(null)}>
          <Folder className="h-4 w-4 mr-2" />
          Uncategorized
        </DropdownMenuItem>
        {categories.map((category) => (
          <DropdownMenuItem key={category.id} onClick={() => assignCategory(category.id)}>
            <div
              className="h-3 w-3 rounded-full mr-2"
              style={{ backgroundColor: getColorValue(category.color) }}
            />
            {category.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default SessionCategories;
