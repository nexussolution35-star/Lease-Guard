import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { resetDemoData } from '@/services/workspace'

export interface ResetDemoDataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Confirmation before restoring the demo seed. */
export function ResetDemoDataDialog({ open, onOpenChange }: ResetDemoDataDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
          <AlertDialogDescription>
            All changes made in this browser — across every workspace — are discarded and the original demo
            records are restored. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              resetDemoData()
              toast.success('Demo data reset', { description: 'The original demo records have been restored.' })
            }}
          >
            Reset demo data
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
