#include<iostream>
using namespace std;
int main() {
  cout<<"Enter number: ";
  int n;
  cin>>n;
  int sum = 0;
  for (int i = 0; n>=i; i++){
    cout<<i<<" "; 
    sum += i;
  }
  cout<<"Sum: "<<sum;
  cout<<endl;
  return 0;
}