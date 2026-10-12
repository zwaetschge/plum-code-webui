import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export function OfficeIntegrationPanel() {
  return (
    <Card id="office-integration">
      <CardHeader>
        <CardTitle>Plum in Word</CardTitle>
        <CardDescription>
          Ausgewählte Textstellen bearbeiten oder als Task-Entwurf übernehmen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Öffne Plum als Word-Add-in und verbinde dort dein Konto. Antworten erscheinen zuerst als
          Vorschlag; erst deine Übernahme ersetzt die ursprüngliche Stelle. Task-Entwürfe startest
          du anschliessend in Plum.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href="/office/manifest.xml" download="plum-word.xml">
              Word-Manifest herunterladen
            </a>
          </Button>
          <Button asChild variant="outline">
            <a
              href="https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-office-add-ins-for-testing"
              target="_blank"
              rel="noopener noreferrer"
            >
              Add-in in Word einrichten
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Textdialoge verwenden deine eingerichteten API-Modelle. Ein Task-Entwurf ist auch ohne
          API-Verbindung möglich.
        </p>
      </CardContent>
    </Card>
  );
}
