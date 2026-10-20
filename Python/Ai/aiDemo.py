import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import datasets, transforms
from torch.utils.data import DataLoader
import os

# 1. Define the Neural Network Architecture
class DigitRecognizerNet(nn.Module):
    def __init__(self):
        super(DigitRecognizerNet, self).__init__()
        self.network = nn.Sequential(
            nn.Flatten(),
            nn.Linear(784, 128),
            nn.ReLU(),
            nn.Linear(128, 128),
            nn.ReLU(),
            nn.Linear(128, 10)
        )
        
    def forward(self, x):
        return self.network(x)

def main():
    # 2. Data Loading & Preprocessing
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.1307,), (0.3081,))
    ])

    train_dataset = datasets.MNIST(root='./data', train=True, download=True, transform=transform)
    test_dataset = datasets.MNIST(root='./data', train=False, download=True, transform=transform)

    # Determine the number of CPU cores for parallel data loading
    # Using 2 or 4 workers usually helps prevent data loading bottlenecks
    num_workers = min(4, os.cpu_count() or 1)

    use_pin_memory = torch.cuda.is_available()

    train_loader = DataLoader(
        train_dataset, 
        batch_size=64, 
        shuffle=True, 
        num_workers=num_workers, 
        pin_memory=use_pin_memory
    )
    test_loader = DataLoader(
        test_dataset, 
        batch_size=1000, 
        shuffle=False, 
        num_workers=num_workers, 
        pin_memory=use_pin_memory
    )

    # 3. Initialization
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training on device: {device}")  # Verify if CUDA is active

    model = DigitRecognizerNet().to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.003)

    # 4. Training Loop (5 Epochs)
    num_epochs = 5
    for epoch in range(1, num_epochs + 1):
        model.train()
        for batch_idx, (data, target) in enumerate(train_loader):
            data, target = data.to(device, non_blocking=True), target.to(device, non_blocking=True)
            
            optimizer.zero_grad()
            output = model(data)
            loss = criterion(output, target)
            loss.backward()
            optimizer.step()
            
            if batch_idx % 200 == 0:
                print(f"Epoch {epoch}/{num_epochs} | Batch {batch_idx}/{len(train_loader)} | Loss: {loss.item():.4f}")

    # 5. Evaluation
    model.eval()
    correct = 0
    with torch.no_grad():
        for data, target in test_loader:
            data, target = data.to(device, non_blocking=True), target.to(device, non_blocking=True)
            output = model(data)
            pred = output.argmax(dim=1, keepdim=True)
            correct += pred.eq(target.view_as(pred)).sum().item()

    accuracy = 100. * correct / len(test_loader.dataset)
    print(f"\nTest Accuracy: {accuracy:.2f}%")

    # 6. Save the trained model
    torch.save(model.state_dict(), 'digit_recognizer.pth')
    print("Model saved to digit_recognizer.pth")

if __name__ == '__main__':
    main()